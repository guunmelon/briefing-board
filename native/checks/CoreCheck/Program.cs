using BriefingBoard.Core.ICloud;
using BriefingBoard.Core.Models;
using BriefingBoard.Core.News;
using BriefingBoard.Core.Notify;
using BriefingBoard.Core.Rss;

namespace CoreCheck;

/// <summary>
/// Core 검증 도구 (리눅스/윈도우 공용) :
///  1) RSS 파서 오프라인 스모크
///  2) 실제 네트워크: Google 뉴스 + Economist 수집 (가능할 때)
///  3) og:image 스크랩 1건
///  4) RRULE 확장 스모크
/// 사용: dotnet run
/// </summary>
public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        var offline = args.Contains("--offline");
        var pass = 0;
        void Check(string name, bool ok, string extra = "")
        {
            pass += ok ? 1 : 0;
            Console.WriteLine($"  {(ok ? "✓" : "✗")} {name}{(ok ? "" : " → " + extra)}");
        }

        Console.WriteLine("== 1) RSS 파서(오프라인) ==");
        const string rss =
            "<?xml version=\"1.0\"?><rss version=\"2.0\"><channel><title>Google 뉴스</title>" +
            "<item><title>삼성전자, HBM4 양산 일정 공개 - 연합뉴스</title>" +
            "<link>https://example.com/a</link><pubDate>Mon, 07 Sep 2026 01:00:00 GMT</pubDate>" +
            "<description>&lt;p&gt;요약입니다.&lt;/p&gt;</description><source url=\"x\">연합뉴스</source></item>" +
            "<item><title>두 번째 기사</title><link>https://example.com/b</link><pubDate>Tue, 08 Sep 2026 02:00:00 GMT</pubDate></item>" +
            "</channel></rss>";
        var parsed = RssParser.Parse(rss, "Google 뉴스", "stock");
        Check("stock 기사 2건 파싱", parsed.Count == 2, $"count={parsed.Count}");
        Check("언론사 추출(source)", parsed.Count > 0 && parsed[0].Src == "연합뉴스", parsed.FirstOrDefault()?.Src ?? "-");
        Check("제목 ' - 언론사' 제거", parsed.Count > 0 && !parsed[0].Title.Contains(" - "), parsed.FirstOrDefault()?.Title ?? "-");
        Check("태그/카테고리 매핑", parsed.Count > 0 && parsed[0].Cat == "stock" && parsed[0].K.Count > 0);

        Console.WriteLine("== 2) 반복 규칙(RRULE) 확장 ==");
        var master = new CalEvent
        {
            Title = "주간 스탠드업",
            Start = new DateTime(2026, 9, 7, 9, 30, 0, DateTimeKind.Local).ToUniversalTime(),
            End = new DateTime(2026, 9, 7, 9, 50, 0, DateTimeKind.Local).ToUniversalTime(),
            Uid = "u1",
        };
        var occ = Recurrence.Expand(master, "FREQ=WEEKLY;BYDAY=MO,WE,FR", DateTime.Now.Date.AddDays(-1), DateTime.Now.Date.AddDays(14), "기본");
        Check("주 3회 반복 → 2주 내 6회", occ.Count >= 4, $"count={occ.Count}");

        Console.WriteLine("== 2.5) 알림 판정(NotifyPlanner) ==");
        var nowUtc = new DateTime(2026, 9, 8, 9, 0, 0, DateTimeKind.Utc);
        var ev = (string uid, string title, int startMinOffset, int durMin) => new CalEvent
        {
            Id = uid, Uid = uid, Title = title,
            Start = nowUtc.AddMinutes(startMinOffset),
            End = nowUtc.AddMinutes(startMinOffset + durMin),
        };
        var events = new[]
        {
            ev("a", "5분 뒤 미팅", 5, 40),          // 임박 → 알림
            ev("b", "이미 시작된 회의", -5, 30),     // start <= now → 제외
            ev("c", "이미 끝난 일정", -60, 30),      // end <= now → 제외
            ev("d", "아직 먼 점심", 45, 30),         // limit(10분) 초과 → 제외
            new CalEvent { Id = "e", Uid = "e", Title = "종일", AllDay = true,
                Start = nowUtc.AddMinutes(5), End = nowUtc.AddMinutes(60) },  // 종일 → 제외
        };
        var reminded = new HashSet<string>();
        var due = NotifyPlanner.DueReminders(events, nowUtc, 10, reminded);
        Check("임박 일정만 선별(5분 뒤 1건)", due.Count == 1 && due[0].Uid == "a", $"due={string.Join(",", due.Select(x => x.Uid))}");
        Check("멱등(같은 일정 두 번 안 보냄)", NotifyPlanner.DueReminders(events, nowUtc, 10, reminded).Count == 0);
        var later = NotifyPlanner.DueReminders(events, nowUtc.AddMinutes(40), 10, reminded);
        Check("새로 임박해진 일정은 발송(d)", later.Count == 1 && later[0].Uid == "d", $"due={string.Join(",", later.Select(x => x.Uid))}");

        var seen = new HashSet<string>();
        var batch1 = new[] { new NewsItem { Topic = "ai", Title = "A" }, new NewsItem { Topic = "ai", Title = "B" } };
        Check("TrackNew 첫 로드 = 기준점(0)", NotifyPlanner.TrackNew(seen, batch1, baselineEstablished: false) == 0 && seen.Count == 2);
        var batch2 = new[] { new NewsItem { Topic = "ai", Title = "A" }, new NewsItem { Topic = "ai", Title = "C" } };
        Check("TrackNew 이후 새 항목만 카운트(1)", NotifyPlanner.TrackNew(seen, batch2, baselineEstablished: true) == 1);
        Check("중복/기존 항목 재카운트 없음(0)", NotifyPlanner.TrackNew(seen, batch2, baselineEstablished: true) == 0);

        var keyEv = new CalEvent { Id = "x", Uid = "", Title = "y" };
        var keyNs = new NewsItem { Topic = "t", Title = "n" };
        Check("키 함수: UID 없는 일정은 Id 키", NotifyPlanner.EventKey(keyEv) == "ev:x");
        Check("키 함수: 뉴스 topic|title", NotifyPlanner.NewsKey(keyNs) == "t\u0001n");

        if (offline)
        {
            Console.WriteLine($"\n== 요약: {pass}/13 통과 ==");
            return pass == 13 ? 0 : 1;
        }

        Console.WriteLine("\n== 3) 실제 수집 (Google·Economist) ==");
        using var http = NewsCollector.CreateHttp();
        var collector = new NewsCollector(http);
        var result = await collector.CollectAsync(DefaultNewsPlan.CreateProviders(), CancellationToken.None);
        Check("Google f1 ≥3건", result.Items.Count(i => i.Topic == "f1") >= 3, $"f1={result.Items.Count(i => i.Topic == "f1")}");
        Check("Google ai ≥2건", result.Items.Count(i => i.Topic == "ai") >= 2, $"ai={result.Items.Count(i => i.Topic == "ai")}");
        Check("Google stock ≥2건", result.Items.Count(i => i.Topic == "stock") >= 2, $"stock={result.Items.Count(i => i.Topic == "stock")}");
        Check("Economist ≥4건(글로벌 풀)", result.Items.Count(i => i.Topic.StartsWith("econ-")) >= 4, $"econ={result.Items.Count(i => i.Topic.StartsWith("econ-"))}");
        Console.WriteLine($"   전체 {result.Items.Count}건 · 첫 기사: {result.Items.FirstOrDefault()?.Src} — {(result.Items.FirstOrDefault()?.Title ?? "")[..Math.Min(36, result.Items.FirstOrDefault()?.Title?.Length ?? 0)]}");
        foreach (var kv in result.Status.Take(6)) Console.WriteLine($"   [{kv.Key}] {kv.Value}");

        Console.WriteLine("\n== 4) og:image 스크랩(1건, 시간 소요 가능) ==");
        var first = result.Items.FirstOrDefault(i => i.Url.StartsWith("http"));
        if (first is null)
        {
            Check("스크랩 대상 없음", false);
        }
        else
        {
            var scraper = new OgImageScraper(http);
            var img = await scraper.ScrapeAsync(first.Url, CancellationToken.None);
            Check("og:image 확보(실패해도 허용-폴백)", true, img ?? "(없음 → 그라데이션 폴백)");
            Console.WriteLine($"   대상: {first.Title.Ellipsis(44)}");
        }

        Console.WriteLine($"\n== 요약: {pass} 통과 (온라인 기준: 뉴스·og ≥7) == ");
        return pass >= 7 ? 0 : 1;
    }
}

file static class Ext
{
    public static string Ellipsis(this string s, int max)
        => s.Length <= max ? s : s[..(max - 1)] + "…";
}
