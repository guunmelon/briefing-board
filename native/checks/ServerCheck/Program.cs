using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using BriefingBoard.Core.Models;
using BriefingBoard.Core.News;
using BriefingBoard.Host;

namespace ServerCheck;

/// <summary>
/// NativeServer 검증(리눅스/윈도우 공용):
///  1) 정적 index.html 서빙
///  2) /api/health, /api/prefs(GET/POST/오류), /api/events(비활성 경로)
///  3) /api/news/refresh → 실제 Core 수집(네트워크)
///  4) og:image 충전(로컬 픽스처 — 결정적 검증)
/// 사용: dotnet run -c Release [--webroot /path/to/dist]
/// </summary>
public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        var webRoot = "/home/user/briefing-board/dist";
        var serve = false;
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == "--webroot") webRoot = args[++i];
            if (args[i] == "--serve") serve = true;
        }
        if (args.Contains("--serve")) serve = true;
        if (!Directory.Exists(webRoot)) { Console.WriteLine($"웹루트 없음: {webRoot}"); return 1; }

        var prefs = await Preferences.LoadAsync();

        if (serve)
        {
            var srv = new NativeServer(webRoot, prefs, secretReader: () => null);
            srv.Start();
            Console.WriteLine($"PORT={srv.Port}");
            Console.Out.Flush();
            await Task.Delay(Timeout.Infinite);
            return 0;
        }

        prefs.CalendarEnabled = false;
        await prefs.SaveAsync();

        var server = new NativeServer(webRoot, prefs, secretReader: () => null);
        server.Start();
        var baseUrl = $"http://127.0.0.1:{server.Port}";
        Console.WriteLine($"NativeServer 포트 {server.Port} (웹루트: {webRoot})");

        int pass = 0;
        void Check(string name, bool ok, string extra = "")
        {
            pass += ok ? 1 : 0;
            Console.WriteLine($"  {(ok ? "✓" : "✗")} {name}{(ok ? "" : " → " + extra)}");
        }

        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(90) };

        // 1) 정적 UI
        var html = await http.GetStringAsync($"{baseUrl}/");
        Check("정적 index.html 서빙(50KB↑)", html.Length > 50_000, $"len={html.Length}");
        Check("  v6.2 마커 포함", html.Contains("v6.2"));

        // 2) health
        var health = JsonNode.Parse(await http.GetStringAsync($"{baseUrl}/api/health"));
        Check("health: native=true", health?["native"]?.GetValue<bool>() == true);

        // 3) prefs GET/POST
        var prefsNow = JsonNode.Parse(await http.GetStringAsync($"{baseUrl}/api/prefs"));
        Check("prefs: 기본 필드", prefsNow?["newsPollMinutes"] is not null);
        var post = await http.PostAsJsonAsync($"{baseUrl}/api/prefs", new { topmost = false });
        var postBody = await post.Content.ReadAsStringAsync();
        Check("prefs: POST 200", post.IsSuccessStatusCode, postBody);
        var after = JsonNode.Parse(await http.GetStringAsync($"{baseUrl}/api/prefs"));
        Check("prefs: 반영(topmost=false)", after?["topmost"]?.GetValue<bool>() == false);
        var bad = await http.PostAsJsonAsync($"{baseUrl}/api/prefs", "깨진본문");
        Check("prefs: 오류 입력 → 400", (int)bad.StatusCode == 400);
        await http.PostAsJsonAsync($"{baseUrl}/api/prefs", new { topmost = true });

        // 4) events(미설정 경로)
        var events = JsonNode.Parse(await http.GetStringAsync($"{baseUrl}/api/events"));
        Check("events: 미설정 → enabled=false", events?["enabled"]?.GetValue<bool>() == false);

        // 5) 뉴스 강제 수집(네트워크)
        Console.WriteLine("  ─ 뉴스 강제 수집(네트워크, ~10초) ─");
        var news = JsonNode.Parse(await http.GetStringAsync($"{baseUrl}/api/news/refresh"));
        int count = news?["count"]?.GetValue<int>() ?? 0;
        var status = news?["status"] as JsonObject;
        Check("news: 수집 ≥15건", count >= 15, $"count={count}");
        Console.Write("    상태: ");
        Console.WriteLine(status is null ? "(없음)" : string.Join(", ", status.Select(kv => $"{kv.Key}={kv.Value}")));
        Check("news: 토픽별 6종 이상", (status?.Count ?? 0) >= 6, $"statuses={status?.Count}");

        // 6) 두 번째 호출은 캐시 반환 확인(응답 빠름)
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var news2 = JsonNode.Parse(await http.GetStringAsync($"{baseUrl}/api/news"));
        sw.Stop();
        Check("news: 캐시 재사용(즉시)", news2?["count"]?.GetValue<int>() == count && sw.ElapsedMilliseconds < 1500, $"ms={sw.ElapsedMilliseconds}");

        // 7) 알 수 없는 경로 404
        var nf = await http.GetAsync($"{baseUrl}/api/nope");
        Check("미지원 경로 404", nf.StatusCode == System.Net.HttpStatusCode.NotFound);

        // 8) 자격증명(iCloud 앱 특수 암호) + autoStart 설정 왕복
        Console.WriteLine("  ─ 자격증명 · autoStart ─");
        var cred0 = JsonNode.Parse(await http.GetStringAsync($"{baseUrl}/api/credentials"));
        string origEmail = (cred0?["email"]?.GetValue<string>()) ?? "";
        var credPost = await http.PostAsJsonAsync($"{baseUrl}/api/credentials",
            new { email = "test@example.com", password = "abcd-efgh-ijkl-mnop" });
        Check("cred: 저장 200", credPost.IsSuccessStatusCode, await credPost.Content.ReadAsStringAsync());
        var cred1 = JsonNode.Parse(await http.GetStringAsync($"{baseUrl}/api/credentials"));
        Check("cred: hasPassword + 이메일", cred1?["hasPassword"]?.GetValue<bool>() == true
            && (cred1?["email"]?.GetValue<string>()) == "test@example.com");
        var del = await http.PostAsJsonAsync($"{baseUrl}/api/credentials", new { delete = true });
        var cred2 = JsonNode.Parse(await http.GetStringAsync($"{baseUrl}/api/credentials"));
        Check("cred: 삭제 후 hasPassword=false", del.IsSuccessStatusCode && cred2?["hasPassword"]?.GetValue<bool>() == false);
        if (!string.IsNullOrEmpty(origEmail) && origEmail != "test@example.com")
            await http.PostAsJsonAsync($"{baseUrl}/api/prefs", new { calendarEmail = origEmail });

        var atOn = await http.PostAsJsonAsync($"{baseUrl}/api/prefs", new { autoStart = true });
        var prefsOn = JsonNode.Parse(await http.GetStringAsync($"{baseUrl}/api/prefs"));
        Check("autoStart: true 저장", atOn.IsSuccessStatusCode && prefsOn?["autoStart"]?.GetValue<bool>() == true);
        await http.PostAsJsonAsync($"{baseUrl}/api/prefs", new { autoStart = false });

        // 9) og:image 충전 (로컬 픽스처 — 실제 HTTP 경로 + 파서를 결정적으로 검증)
        Console.WriteLine("  ─ og:image 충전(로컬 픽스처) ─");
        using (var fixture = new HttpMini(async ctx =>
        {
            if (ctx.Path.StartsWith("/art/ok"))
            {
                await ctx.WriteTextAsync(200, "text/html; charset=utf-8",
                    "<html><head><meta property=\"og:image\" content=\"https://cdn.example.com/pic.jpg\"/>" +
                    "<meta name=\"twitter:image\" content=\"https://cdn.example.com/ignored.jpg\"/></head>" +
                    "<body>기사 본문</body></html>");
                return;
            }
            await ctx.WriteTextAsync(404, "text/plain; charset=utf-8", "no");
        }))
        {
            fixture.Start();
            var fBase = $"http://127.0.0.1:{fixture.Port}";
            var fake = new List<NewsItem>
            {
                new() { Title = "A", Url = $"{fBase}/art/ok/1", Rss = true, H = 1 },
                new() { Title = "B", Url = $"{fBase}/art/ok/2", Rss = true },
                new() { Title = "C(404)", Url = $"{fBase}/art/missing", Rss = true },
                new() { Title = "D(비RSS)", Url = $"{fBase}/art/ok/3", Rss = false },
            };
            var attempted = new HashSet<string>();
            using var thumbHttp = NewsCollector.CreateHttp();
            await OgImageEnricher.EnrichAsync(thumbHttp, fake, attempted, CancellationToken.None,
                maxAttempts: 5, perLink: TimeSpan.FromSeconds(3), totalCap: TimeSpan.FromSeconds(8));

            Check("썸네일 채움(헤드라인·일반)", fake[0].Img == "https://cdn.example.com/pic.jpg" && fake[1].Img == "https://cdn.example.com/pic.jpg",
                $"A={fake[0].Img} B={fake[1].Img}");
            Check("404 → null 유지 + 시도 기록", string.IsNullOrEmpty(fake[2].Img) && attempted.Contains($"{fBase}/art/missing"));
            Check("비RSS 항목은 대상 아님", string.IsNullOrEmpty(fake[3].Img));
            var again = await OgImageEnricher.EnrichAsync(thumbHttp, fake, attempted, CancellationToken.None,
                maxAttempts: 5, perLink: TimeSpan.FromSeconds(3), totalCap: TimeSpan.FromSeconds(8));
            Check("재시도 없음(attempted 기억)", again == 0, $"again={again}");
        }

        server.Dispose();
        Console.WriteLine($"\n== 요약: {pass}/17 통과 ==");
        return pass >= 15 ? 0 : 1;
    }
}
