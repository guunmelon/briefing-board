using BriefingBoard.Core.Models;

namespace BriefingBoard.Core.Rss;

/// <summary>
/// 관심사 하나를 '사진 포함 매체 피드 우선 + Google 뉴스 보강' 하이브리드로 수집한다.
///  - 데모 스냅샷 생성기(tools/fetch-rss.js 의 TOPIC_GROUPS)와 동일한 정책.
///  - 매체 피드는 RSS에 media:thumbnail/content(사진)를 싣는 언론사로, 실제 기사 대표 사진이
///    카드에 보이도록 먼저 채운다. 토픽에 안 맞는 일반 피드는 키워드 필터로 거른다.
///  - 부족분은 Google 뉴스 검색으로 보강(사진 없음 → 뒤에 배치, 이후 og:image 채움 경로로 처리).
/// </summary>
public sealed class HybridTopicProvider : INewsProvider
{
    public string Name { get; }
    private readonly string _topic;
    private readonly IReadOnlyList<MediaFeed> _feeds;
    private readonly GoogleFallback? _google;
    private readonly int _take;

    public sealed record MediaFeed(string Url, string Brand, IReadOnlyList<string> Terms);
    public sealed record GoogleFallback(string Query, string Hl, string Gl);

    public HybridTopicProvider(string topic, IEnumerable<MediaFeed> feeds, GoogleFallback? google, int take = 6)
    {
        _topic = topic;
        _feeds = feeds.ToList();
        _google = google;
        _take = take;
        Name = "topic:" + topic;
    }

    public int TakeLimit => _take;

    public async Task<List<NewsItem>> FetchAsync(HttpClient http, CancellationToken ct)
    {
        var picked = new List<NewsItem>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        bool Push(NewsItem it)
        {
            if (picked.Count >= _take) return false;
            var sig = string.Concat(it.Title.Where(ch => !char.IsWhiteSpace(ch))).ToLowerInvariant();
            if (sig.Length == 0 || !seen.Add(sig)) return false;
            picked.Add(it);
            return true;
        }

        // 1) 사진 포함 매체 피드 — 최신순 → 토픽 키워드 필터
        foreach (var feed in _feeds)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                using var resp = await http.GetAsync(feed.Url, ct);
                if (!resp.IsSuccessStatusCode) continue;
                var xml = await resp.Content.ReadAsStringAsync(ct);
                var items = RssParser.Parse(xml, feed.Brand, _topic);
                foreach (var it in items) it.Src = feed.Brand;   // 매체 피드는 피드 자체가 출처(브랜드 고정)
                var ordered = items
                    .Where(it => Matches(it, feed.Terms))
                    .OrderByDescending(it => ParseDate(it.Pub))
                    .ToList();
                foreach (var it in ordered) { if (!Push(it)) break; }
            }
            catch (OperationCanceledException) { throw; }
            catch { /* 개별 피드 실패 무시 — 다음 피드/구글 보강 */ }

            if (picked.Count >= _take) break;
            try { await Task.Delay(350, ct); } catch (OperationCanceledException) { throw; }
        }

        // 2) 부족분: Google 뉴스 검색 (채널/클립성 저품질 소스 제외)
        if (picked.Count < _take && _google is not null)
        {
            try
            {
                var g = _google;
                var ceid = g.Hl == "ko" ? "KR:ko" : "US:en";
                var url = $"https://news.google.com/rss/search?q={Uri.EscapeDataString(g.Query)}&hl={g.Hl}&gl={g.Gl}&ceid={ceid}";
                using var resp = await http.GetAsync(url, ct);
                if (resp.IsSuccessStatusCode)
                {
                    var xml = await resp.Content.ReadAsStringAsync(ct);
                    var items = RssParser.Parse(xml, "Google 뉴스", _topic);
                    foreach (var it in items.OrderByDescending(i => ParseDate(i.Pub)))
                    {
                        if (IsJunkSource(it.Src)) continue;   // 유튜브 채널/클립·SNS 재게시는 노이즈
                        if (!Push(it)) break;
                    }
                }
            }
            catch (OperationCanceledException) { throw; }
            catch { /* 구글 보강 실패는 무시 */ }
        }

        // 사진이 있는 기사가 앞(헤드라인)에 오도록 정렬
        var outItems = picked
            .OrderByDescending(i => !string.IsNullOrEmpty(i.Img))
            .ThenByDescending(i => ParseDate(i.Pub))
            .Take(_take)
            .ToList();
        if (outItems.Count > 0) outItems[0].H = 1;
        return outItems;
    }

    /// <summary>구글뉴스에 섞이는 채널 알림·클립성 저품질 소스 (매체 피드는 무관)</summary>
    private static readonly string[] JunkSources =
    {
        "YouTube", "Youtube", "youtube", "Facebook", "TikTok", "Instagram", "Twitter", "Reddit", "Mshale", "mshale",
    };
    private static bool IsJunkSource(string src) => JunkSources.Contains(src, StringComparer.OrdinalIgnoreCase);

    private static bool Matches(NewsItem it, IReadOnlyList<string> terms)
    {
        if (terms.Count == 0) return true;
        var title = it.Title;
        foreach (var t in terms)
        {
            if (t.Length == 0) continue;
            if (title.Contains(t, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static DateTime ParseDate(string pub)
    {
        return DateTime.TryParse(pub, System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal, out var d)
            ? d : DateTime.MinValue;
    }
}
