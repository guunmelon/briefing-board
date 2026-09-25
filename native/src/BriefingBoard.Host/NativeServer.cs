using System.Net.Http;
using System.IO;
using BriefingBoard.Core.ICloud;
using BriefingBoard.Core.Models;
using BriefingBoard.Core.News;
using BriefingBoard.Core.Notify;
using BriefingBoard.Core.Rss;
using BriefingBoard.Core.Storage;

namespace BriefingBoard.Host;

/// <summary>
/// 네이티브 로컬 데이터 서버.
///  - 정적 웹 콘텐츠(빌드 시 복사된 dist/index.html) 서빙 → WebView2 가 http://127.0.0.1 에서 로드
///  - Core 서비스 기반 JSON API(/api/news, /api/events, /api/prefs, /api/health)
///  - 디스크 캐시 + 백그라운드 갱신 폴링(설정 주기)
/// HttpListener(URL ACL 필요) 대신 HttpMini(TcpListener)를 쓴다.
/// </summary>
public sealed class NativeServer : IDisposable
{
    private readonly HttpMini _http;
    private readonly string _webRoot;
    private readonly Preferences _prefs;
    private readonly Func<string?> _secretReader;
    private readonly Action? _onPrefsChanged;
    private readonly JsonStore _store;
    private readonly CancellationTokenSource _cts = new();
    private readonly SemaphoreSlim _newsGate = new(1, 1);
    private readonly SemaphoreSlim _calGate = new(1, 1);

    /// <summary>이미 og:image 를 시도한 원문 URL(성공·실패) — 폴링이 중복 네트워크를 안 내도록</summary>
    private readonly HashSet<string> _thumbAttempted = new(StringComparer.OrdinalIgnoreCase);

    // ---------- /imgp 이미지 프록시(외신 핫링크·레퍼러 차단 우회용) ----------
    private sealed class ImgCacheEntry { public byte[] Bytes = Array.Empty<byte>(); public string Type = ""; public long Expires; }
    private readonly Dictionary<string, ImgCacheEntry> _imgCache = new(StringComparer.Ordinal);
    private readonly HttpClient _proxyHttp = new();
    private const string _webUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

    // ---------- 알림 상태 (notify-state.json) ----------
    private readonly HashSet<string> _seenNews = new(StringComparer.Ordinal);
    private readonly HashSet<string> _remindedEvents = new(StringComparer.Ordinal);
    private bool _seenBaseline;        // 최초 실행 후 기준점 확립 여부
    private bool _notifyDirty;
    private const int NotifyStateCap = 600;
    private const string NotifyStateFile = "notify-state.json";

    /// <summary>새 헤드라인(첫 로드 제외) 도착 시 발행 — UI(트레이 풍선)용.</summary>
    public event Action<int>? NewsArrived;

    /// <summary>시작 전 임박 일정 리마인더(멱등) — UI(트레이 풍선)용.</summary>
    public event Action<IReadOnlyList<CalEvent>>? RemindersDue;

    public int Port => _http.Port;

    public NativeServer(string webRoot, Preferences prefs, Func<string?> secretReader, Action? onPrefsChanged = null)
    {
        _webRoot = webRoot;
        _prefs = prefs;
        _secretReader = secretReader;
        _onPrefsChanged = onPrefsChanged;
        _store = new JsonStore(AppPaths.RootDir);
        _http = new HttpMini(RouteAsync);
    }

    public void Start()
    {
        _http.Start();
        AppLog.Write($"SERVER 시작 — 포트 {_http.Port} · 웹루트 '{_webRoot}'");
        LoadNotifyState();
        _ = Task.Run(() => PollLoopAsync(_cts.Token));
        _ = Task.Run(() => ReminderLoopAsync(_cts.Token));
    }

    // ======================= 알림 상태 관리 =======================

    private void LoadNotifyState()
    {
        try
        {
            var f = _store.LoadAsync<NotifyStateFile>(NotifyStateFile).GetAwaiter().GetResult();
            if (f is null) return;
            if (f.SeenKeys is not null) foreach (var k in f.SeenKeys) _seenNews.Add(k);
            if (f.RemindedKeys is not null) foreach (var k in f.RemindedKeys) _remindedEvents.Add(k);
            _seenBaseline = _seenNews.Count > 0;
        }
        catch { /* 상태 없음/깨짐 — 첫 로드 취급 */ }
    }

    private async Task PersistNotifyStateAsync()
    {
        if (!_notifyDirty) return;
        _notifyDirty = false;
        try
        {
            var f = new NotifyStateFile
            {
                SeenKeys = Prune(_seenNews),
                RemindedKeys = Prune(_remindedEvents),
            };
            await _store.SaveAsync(NotifyStateFile, f);
        }
        catch { /* 알림 상태 저장 실패는 치명적이지 않음 — 다음 변경 때 재시도 */ }
    }

    private List<string> Prune(HashSet<string> set)
    {
        var list = set.ToList();
        if (list.Count > NotifyStateCap) { list = list.Skip(list.Count - NotifyStateCap).ToList(); set.Clear(); foreach (var x in list) set.Add(x); }
        return list;
    }

    /// <summary>수집 직후 호출 — 첫 로드는 기준점만, 이후 새 항목 수만큼 이벤트.</summary>
    private void RecordNews(IEnumerable<NewsItem> items)
    {
        int fresh;
        lock (_seenNews)
        {
            var hadBaseline = _seenBaseline;
            fresh = NotifyPlanner.TrackNew(_seenNews, items, hadBaseline);
            _seenBaseline = true;
            // 기준점 확립(첫 로드)이거나 새 항목이면 상태를 저장(재시작 후에도 감지 기준 유지)
            if (!hadBaseline || fresh > 0) _notifyDirty = true;
        }
        if (fresh > 0) NewsArrived?.Invoke(fresh);
    }

    private void RecordReminders(IEnumerable<CalEvent> events, DateTime nowUtc)
    {
        var due = new List<CalEvent>();
        lock (_remindedEvents)
        {
            due = NotifyPlanner.DueReminders(events, nowUtc, _prefs.RemindLeadMinutes, _remindedEvents);
            if (due.Count > 0) _notifyDirty = true;
        }
        if (due.Count > 0) RemindersDue?.Invoke(due);
    }

    // ======================= 라우팅 =======================

    private async Task RouteAsync(HttpCtx ctx)
    {
        if (ctx.Method == "OPTIONS")
        {
            await ctx.WriteAsync(204, "text/plain", Array.Empty<byte>(),
                "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type", noCache: true);
            return;
        }

        var path = ctx.Path;
        try
        {
            if (path == "/api/health") { await ApiHealthAsync(ctx); return; }

            if (path == "/api/news") { await ApiNewsAsync(ctx, force: false); return; }
            if (path == "/api/news/refresh") { await ApiNewsAsync(ctx, force: true); return; }

            if (path == "/api/events") { await ApiEventsAsync(ctx, force: false); return; }
            if (path == "/api/events/refresh") { await ApiEventsAsync(ctx, force: true); return; }

            if (path == "/api/prefs")
            {
                if (ctx.Method == "GET") { await ApiPrefsGetAsync(ctx); return; }
                if (ctx.Method == "POST") { await ApiPrefsPostAsync(ctx); return; }
            }

            if (path == "/api/credentials")
            {
                if (ctx.Method == "GET") { await ApiCredGetAsync(ctx); return; }
                if (ctx.Method == "POST") { await ApiCredPostAsync(ctx); return; }
            }

            if (path == "/imgp") { await ServeImageProxyAsync(ctx); return; }   // 외부 기사 사진 로컬 프록시

            await ServeStaticAsync(ctx);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            await ctx.WriteJsonAsync(500, Bridge.ToJson(new { ok = false, error = ex.Message }));
        }
    }

    // ======================= API: 뉴스 =======================

    private async Task ApiNewsAsync(HttpCtx ctx, bool force)
    {
        var snap = await EnsureNewsAsync(force, _cts.Token);
        // og:image 는 절대 URL 그대로 내려준다. 렌더러(host.js)가 핫링크 차단을
        // 피하기 위해 로컬 /imgp?u=… 프록시 주소로 다시 써서 요청한다.
        var payload = new
        {
            ok = true,
            generated = snap.Generated,
            count = snap.Items.Count,
            status = snap.Status,
            items = snap.Items,
        };
        await ctx.WriteJsonAsync(200, Bridge.ToJson(payload));
    }

    public async Task<NewsSnapshot> EnsureNewsAsync(bool force, CancellationToken ct)
    {
        var stale = TimeSpan.FromMinutes(Math.Max(1, _prefs.NewsPollMinutes));
        if (!force)
        {
            var cached = await _store.LoadAsync<NewsSnapshot>("news-cache.json");
            if (cached is { Items.Count: > 0 } && DateTime.UtcNow - cached.Generated < stale)
                return cached;
        }

        await _newsGate.WaitAsync(ct);
        try
        {
            var again = await _store.LoadAsync<NewsSnapshot>("news-cache.json");
            if (!force && again is { Items.Count: > 0 } && DateTime.UtcNow - again.Generated < stale)
                return again;

            using var http = NewsCollector.CreateHttp();
            http.Timeout = TimeSpan.FromSeconds(45);
            var collector = new NewsCollector(http);
            var res = await collector.CollectAsync(DefaultNewsPlan.CreateProviders(), ct);
            var snap = new NewsSnapshot { Items = res.Items, Status = res.Status, Generated = res.Generated };
            if (res.Items.Count > 0)
            {
                // 대표 기사 og:image 썸네일(제한적) → 캐시에 이미지 포함 저장
                await EnrichThumbnailsAsync(snap.Items, http, ct);
                await _store.SaveAsync("news-cache.json", snap);
                RecordNews(snap.Items);               // 새 소식 감지(첫 로드 제외)
                await PersistNotifyStateAsync();
            }
            return snap;
        }
        finally
        {
            _newsGate.Release();
        }
    }

    // ======================= API: 캘린더(iCloud CalDAV) =======================

    private async Task ApiEventsAsync(HttpCtx ctx, bool force)
    {
        if (!_prefs.CalendarEnabled)
        {
            await ctx.WriteJsonAsync(200, Bridge.ToJson(new { ok = true, enabled = false, items = Array.Empty<CalEvent>(), message = "캘린더 미설정" }));
            return;
        }
        var secret = _secretReader();
        if (string.IsNullOrEmpty(secret) || string.IsNullOrEmpty(_prefs.CalendarEmail))
        {
            await ctx.WriteJsonAsync(200, Bridge.ToJson(new { ok = false, enabled = true, needsAuth = true, items = Array.Empty<CalEvent>() }));
            return;
        }

        var snap = await EnsureEventsAsync(force, secret, ct: _cts.Token);
        await ctx.WriteJsonAsync(200, Bridge.ToJson(new
        {
            ok = true,
            enabled = true,
            updated = snap.Updated,
            count = snap.Items.Count,
            items = snap.Items,
        }));
    }

    private async Task<CalendarSnapshot> EnsureEventsAsync(bool force, string secret, CancellationToken ct)
    {
        var stale = TimeSpan.FromSeconds(Math.Max(15, _prefs.CalendarPollSeconds));
        if (!force)
        {
            var cached = await _store.LoadAsync<CalendarSnapshot>("icloud-cache.json");
            if (cached is { Items.Count: > 0 } && DateTime.UtcNow - cached.Updated < stale)
                return cached;
        }

        await _calGate.WaitAsync(ct);
        try
        {
            var again = await _store.LoadAsync<CalendarSnapshot>("icloud-cache.json");
            if (!force && again is { Items.Count: > 0 } && DateTime.UtcNow - again.Updated < stale)
                return again;

            var client = new CalDavClient(_prefs.CalendarEmail!, secret);
            var calendars = await client.DiscoverCalendarsAsync(ct);
            var from = DateTime.Now.AddDays(-1);
            var to = DateTime.Now.AddDays(14);
            var events = new List<CalEvent>();
            foreach (var cal in calendars)
            {
                var evs = await client.QueryEventsAsync(cal, from, to, ct);
                events.AddRange(evs);
                if (events.Count > 120) break; // 안전 상한
            }

            var snap = new CalendarSnapshot
            {
                Updated = DateTime.UtcNow,
                Items = events.OrderBy(e => e.Start).Take(120).ToList(),
                Calendars = calendars.Select(c => c.DisplayName).ToList(),
            };
            if (snap.Items.Count > 0) await _store.SaveAsync("icloud-cache.json", snap);
            return snap;
        }
        finally
        {
            _calGate.Release();
        }
    }

    // ======================= API: 설정 =======================

    private Task ApiPrefsGetAsync(HttpCtx ctx)
    {
        lock (_prefs)
        {
            return ctx.WriteJsonAsync(200, Bridge.ToJson(_prefs));
        }
    }

    private async Task ApiPrefsPostAsync(HttpCtx ctx)
    {
        var raw = System.Text.Encoding.UTF8.GetString(ctx.Body);
        var incoming = Bridge.ReadPrefs(raw);
        if (incoming is null)
        {
            await ctx.WriteJsonAsync(400, Bridge.ToJson(new { ok = false, error = "prefs JSON 파싱 실패" }));
            return;
        }

        lock (_prefs)
        {
            _prefs.Width = Clamp(incoming.Width, 700, 3000, _prefs.Width);
            _prefs.Height = Clamp(incoming.Height, 500, 2400, _prefs.Height);
            if (incoming.Left is not null) _prefs.Left = Clamp(incoming.Left, -2000, 4000, _prefs.Left ?? 0);
            if (incoming.Top is not null) _prefs.Top = Clamp(incoming.Top, -2000, 4000, _prefs.Top ?? 0);
            if (incoming.Topmost is not null) _prefs.Topmost = incoming.Topmost.Value;
            if (incoming.AutoStart is not null) _prefs.AutoStart = incoming.AutoStart.Value;
            if (incoming.NewsPollMinutes is > 0 and <= 180) _prefs.NewsPollMinutes = incoming.NewsPollMinutes.Value;
            if (incoming.CalendarEnabled is not null) _prefs.CalendarEnabled = incoming.CalendarEnabled.Value;
            if (incoming.CalendarEmail is not null) _prefs.CalendarEmail = incoming.CalendarEmail;
            if (incoming.CalendarDisplay is not null) _prefs.CalendarDisplay = incoming.CalendarDisplay;
            if (incoming.CalendarPollSeconds is > 0 and <= 3600) _prefs.CalendarPollSeconds = incoming.CalendarPollSeconds.Value;
            if (incoming.NotificationsEnabled is not null) _prefs.NotificationsEnabled = incoming.NotificationsEnabled.Value;
            if (incoming.RemindLeadMinutes is > 0 and <= 120) _prefs.RemindLeadMinutes = incoming.RemindLeadMinutes.Value;
        }
        await _prefs.SaveAsync();
        _onPrefsChanged?.Invoke();
        await ctx.WriteJsonAsync(200, Bridge.ToJson(new { ok = true }));
    }

    // ======================= API: 자격 증명(iCloud 앱 특수 암호) =======================

    /// <summary>비밀번호 본문은 노출하지 않고, 연결 여부(이메일·hasPassword)만 준다.</summary>
    private async Task ApiCredGetAsync(HttpCtx ctx)
    {
        await ctx.WriteJsonAsync(200, Bridge.ToJson(new
        {
            ok = true,
            email = _prefs.CalendarEmail ?? "",
            hasPassword = CredentialSafe.HasPassword,
        }));
    }

    private async Task ApiCredPostAsync(HttpCtx ctx)
    {
        var raw = System.Text.Encoding.UTF8.GetString(ctx.Body);
        var cred = Bridge.ReadCred(raw);
        if (cred is null)
        {
            await ctx.WriteJsonAsync(400, Bridge.ToJson(new { ok = false, error = "JSON 파싱 실패" }));
            return;
        }

        if (cred.Delete == true)
        {
            CredentialSafe.Delete();
            await ctx.WriteJsonAsync(200, Bridge.ToJson(new { ok = true, email = "", hasPassword = false }));
            return;
        }

        var email = (cred.Email ?? "").Trim();
        var pw = cred.Password ?? "";
        if (!email.Contains('@') || pw.Length < 8)
        {
            await ctx.WriteJsonAsync(400, Bridge.ToJson(new { ok = false, error = "이메일과 앱 특수 암호(8자 이상)를 확인해 주세요." }));
            return;
        }

        CredentialSafe.Write(email, pw);
        lock (_prefs)
        {
            _prefs.CalendarEmail = email;
            if (string.IsNullOrEmpty(_prefs.CalendarDisplay)) _prefs.CalendarDisplay = email;
        }
        await _prefs.SaveAsync();
        _onPrefsChanged?.Invoke();
        await ctx.WriteJsonAsync(200, Bridge.ToJson(new { ok = true, email, hasPassword = true }));
    }

    private static double Clamp(double? v, double lo, double hi, double fallback)
        => !v.HasValue || double.IsNaN(v.Value) ? fallback : Math.Clamp(v.Value, lo, hi);

    // ======================= API: 상태 =======================

    private async Task ApiHealthAsync(HttpCtx ctx)
    {
        var newsAge = -1L;
        var newsCount = 0;
        var cached = await _store.LoadAsync<NewsSnapshot>("news-cache.json");
        if (cached is not null)
        {
            newsAge = (long)(DateTime.UtcNow - cached.Generated).TotalSeconds;
            newsCount = cached.Items.Count;
        }

        await ctx.WriteJsonAsync(200, Bridge.ToJson(new
        {
            ok = true,
            app = "BriefingBoard",
            native = true,
            version = "0.1.0",
            timeUtc = DateTime.UtcNow,
            web = _webRoot,
            news = new { count = newsCount, cacheAgeSec = newsAge },
            calendar = new { enabled = _prefs.CalendarEnabled, email = _prefs.CalendarEmail },
        }));
    }

    // ======================= /imgp 이미지 프록시 (외신 사진 차단 우회) =======================
    // 외부 og:image 는 렌더러가 직접 못 받는 경우(핫링크 차단/레퍼러 검사/CORS)가 많아,
    // 네이티브 서버가 대신 받아(브라우저 UA·원문 Referer 사용) 로컬에서 내려준다.

    private static string? QueryParam(string query, string name)
    {
        foreach (var part in (query ?? "").Split('&'))
        {
            var kv = part.Split('=', 2);
            if (kv.Length == 2 && kv[0].Equals(name, StringComparison.OrdinalIgnoreCase))
            {
                try { return Uri.UnescapeDataString(kv[1].Replace("+", " ")); }
                catch { return kv[1]; }
            }
        }
        return null;
    }

    private async Task ServeImageProxyAsync(HttpCtx ctx)
    {
        var u = QueryParam(ctx.Query, "u");
        var refUrl = QueryParam(ctx.Query, "ref");
        if (string.IsNullOrEmpty(u) || !Uri.TryCreate(u, UriKind.Absolute, out var uri) ||
            (uri.Scheme != "http" && uri.Scheme != "https"))
        {
            await ctx.WriteTextAsync(400, "text/plain", "bad image url", noCache: true);
            return;
        }

        // 캐시 히트
        string? ctype = null; byte[]? cbytes = null;
        lock (_imgCache)
        {
            if (_imgCache.TryGetValue(u, out var hit) && hit.Expires > DateTime.UtcNow.Ticks)
            {
                ctype = hit.Type; cbytes = hit.Bytes;
            }
        }
        if (cbytes != null && ctype != null)
        {
            await ctx.WriteAsync(200, ctype, cbytes, "Cache-Control: public, max-age=86400\r\n", noCache: true);
            return;
        }

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
            cts.CancelAfter(TimeSpan.FromSeconds(14));
            using var req = new HttpRequestMessage(HttpMethod.Get, uri);
            req.Headers.TryAddWithoutValidation("User-Agent", _webUA);
            req.Headers.TryAddWithoutValidation("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
            req.Headers.TryAddWithoutValidation("Accept-Language", "ko,en;q=0.8");
            if (!string.IsNullOrEmpty(refUrl) && Uri.TryCreate(refUrl, UriKind.Absolute, out var refUri))
                req.Headers.Referrer = refUri;
            else
                req.Headers.Referrer = new Uri(uri.Scheme + "://" + uri.Host + "/");

            using var resp = await _proxyHttp.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);
            if (!resp.IsSuccessStatusCode)
            {
                await ctx.WriteTextAsync(404, "text/plain", "image unavailable (" + (int)resp.StatusCode + ")", noCache: true);
                return;
            }

            await using var stream = await resp.Content.ReadAsStreamAsync(cts.Token);
            using var ms = new MemoryStream();
            var buf = new byte[65536]; long total = 0; int n;
            while ((n = await stream.ReadAsync(buf, cts.Token)) > 0)
            {
                total += n;
                if (total > 8_000_000) break;   // 과대 이미지 방지
                ms.Write(buf, 0, n);
            }
            var type = resp.Content.Headers.ContentType?.MediaType ?? "image/jpeg";
            var bytes = ms.ToArray();
            lock (_imgCache)
            {
                if (_imgCache.Count >= 120)
                {
                    var oldest = _imgCache.OrderBy(kv => kv.Value.Expires).FirstOrDefault();
                    if (oldest.Key is not null) _imgCache.Remove(oldest.Key);
                }
                _imgCache[u] = new ImgCacheEntry { Bytes = bytes, Type = type, Expires = DateTime.UtcNow.AddHours(24).Ticks };
            }
            await ctx.WriteAsync(200, type, bytes, "Cache-Control: public, max-age=86400\r\n", noCache: true);
        }
        catch (OperationCanceledException) when (!_cts.IsCancellationRequested)
        {
            await ctx.WriteTextAsync(504, "text/plain", "image timeout", noCache: true);
        }
        catch
        {
            await ctx.WriteTextAsync(404, "text/plain", "image fetch failed", noCache: true);
        }
    }

    // ======================= 정적 콘텐츠 =======================

    private async Task ServeStaticAsync(HttpCtx ctx)
    {
        var rel = ctx.Path;
        if (rel is "/" or "") rel = "/index.html";
        if (!rel.StartsWith('/')) rel = "/" + rel;

        // 경로 이탈 차단
        var full = System.IO.Path.GetFullPath(System.IO.Path.Combine(_webRoot, rel.TrimStart('/')));
        var root = System.IO.Path.GetFullPath(_webRoot);
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !System.IO.File.Exists(full))
        {
            if (rel == "/index.html")
            {
                await ctx.WriteTextAsync(200, "text/html; charset=utf-8", FallbackPage(), noCache: true);
                return;
            }
            await ctx.WriteTextAsync(404, "text/plain; charset=utf-8", "404 not found: " + rel, noCache: true);
            return;
        }

        var bytes = await System.IO.File.ReadAllBytesAsync(full);

        // index.html 이 0바이트(다운로드/복사 손상)면 빈 흰 화면 대신 안내 페이지를 준다.
        if (rel == "/index.html" && bytes.Length == 0)
        {
            AppLog.Write("WARN index.html 0바이트 — 폴백 페이지 응답(재빌드 안내)");
            await ctx.WriteTextAsync(200, "text/html; charset=utf-8", FallbackPage(), noCache: true);
            return;
        }

        await ctx.WriteBytesAsync(bytes, HttpCtx.ContentTypeFor(full), noCache: true);
    }

    private string FallbackPage() =>
        """
        <!doctype html><html lang="ko"><head><meta charset="utf-8">
        <title>BriefingBoard — 네이티브 셸</title>
        <style>
          body{margin:0;height:100vh;display:grid;place-items:center;background:#0d1117;color:#e6edf3;
               font-family:'Segoe UI',system-ui,sans-serif}
          .card{max-width:560px;padding:40px 44px;background:#161b22;border:1px solid #30363d;border-radius:14px}
          h1{font-size:22px;margin:0 0 10px} p{line-height:1.65;color:#9da7b3;margin:6px 0}
          code{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:1px 6px}
          .ok{color:#3fb950;font-weight:600}
        </style></head><body>
        <div class="card">
          <h1>BriefingBoard <span class="ok">●</span> 네이티브 서버 동작 중</h1>
          <p>웹 UI(<code>dist/index.html</code>)를 찾지 못했어요.
             프로젝트에서 <code>dotnet build</code> 하면 <code>dist/index.html</code> 이 자동 복사됩니다.</p>
          <p>API는 정상입니다 — <code>/api/health</code>, <code>/api/news</code> 를 브라우저로 열어 확인하세요.</p>
          <p style="font-size:12px;color:#6e7681">포트 {_http.Port} · 로컬 전용</p>
        </div></body></html>
        """;

    // ======================= og:image 썸네일 (뉴스) =======================

    /// <summary>대표 기사에만 og:image 를 채운다(무거운 작업 제한 + 실패 URL 기억).</summary>
    private async Task EnrichThumbnailsAsync(List<NewsItem> items, HttpClient http, CancellationToken ct)
    {
        if (items.Count == 0) return;
        try
        {
            await OgImageEnricher.EnrichAsync(http, items, _thumbAttempted, ct,
                maxAttempts: 16, perLink: TimeSpan.FromSeconds(9), totalCap: TimeSpan.FromSeconds(55));
        }
        catch { /* 스크랩 전체 실패는 무시 — 그라데이션 폴백 */ }
    }

    /// <summary>이미지 없는 아이템만 골라 점진적으로 채우고 캐시에 저장한다(폴링 경로).</summary>
    private async Task TopUpThumbnailsAsync(CancellationToken ct)
    {
        var snap = await _store.LoadAsync<NewsSnapshot>("news-cache.json");
        if (snap is not { Items.Count: > 0 }) return;
        if (!snap.Items.Any(i => string.IsNullOrEmpty(i.Img))) return;   // 다 채워졌으면 skip

        using var http = NewsCollector.CreateHttp();
        http.Timeout = TimeSpan.FromSeconds(15);
        await EnrichThumbnailsAsync(snap.Items, http, ct);
        try { await _store.SaveAsync("news-cache.json", snap); } catch { /* 다음 주기 */ }
    }

    // ======================= 백그라운드 폴링 =======================

    private async Task PollLoopAsync(CancellationToken ct)
    {
        // 시작 직후 1회(캐시 있으면 스킵) + 주기 폴링
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(20), ct); // 창 로드 이후 여유
                await EnsureNewsAsync(force: false, ct);
                await TopUpThumbnailsAsync(ct);                 // 새로 보인 기사 이미지 점진 채움
                if (_prefs.CalendarEnabled) await EnsureEventsAsync(force: false, _secretReader() ?? "", ct);
                await PersistNotifyStateAsync();
            }
            catch (OperationCanceledException) { break; }
            catch { /* 다음 주기에 재시도 */ }

            try { await Task.Delay(TimeSpan.FromMinutes(Math.Max(1, _prefs.NewsPollMinutes)), ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    /// <summary>30초 주기 리마인더 틱 — 캘린더가 켜져 있으면 근시일 일정을 훑어 시작 전 알림을 발행.</summary>
    private async Task ReminderLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(30), ct);
                if (!_prefs.CalendarEnabled) continue;
                var secret = _secretReader();
                if (string.IsNullOrEmpty(secret) || string.IsNullOrEmpty(_prefs.CalendarEmail)) continue;
                var snap = await EnsureEventsAsync(force: false, secret, ct);   // 캐시가 fresh(60s)면 즉시 반환
                if (snap.Items.Count == 0) continue;
                RecordReminders(snap.Items, DateTime.UtcNow);
                await PersistNotifyStateAsync();
            }
            catch (OperationCanceledException) { break; }
            catch { /* 자격증명 오류·네트워크 일시 장애 — 다음 틱에 재시도 */ }
        }
    }

    public void Dispose()
    {
        _cts.Cancel();
        _http.Dispose();
    }
}

// ---------------- 캐시/스냅샷 DTO (JsonStore 파일 스키마) ----------------

public sealed class NewsSnapshot
{
    public DateTime Generated { get; set; } = DateTime.UtcNow;
    public List<NewsItem> Items { get; set; } = new();
    public Dictionary<string, string> Status { get; set; } = new();
}

public sealed class CalendarSnapshot
{
    public DateTime Updated { get; set; } = DateTime.UtcNow;
    public List<CalEvent> Items { get; set; } = new();
    public List<string> Calendars { get; set; } = new();
}

/// <summary>알림 멱등성 상태(notify-state.json) — 본문 키 목록만 보관(상한 적용).</summary>
public sealed class NotifyStateFile
{
    public List<string> SeenKeys { get; set; } = new();
    public List<string> RemindedKeys { get; set; } = new();
}
