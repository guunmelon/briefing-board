using BriefingBoard.Core.Models;

namespace BriefingBoard.Core.Rss;

public interface INewsProvider
{
    string Name { get; }

    /// <summary>이 제공자가 토픽당 브리핑 풀에 반영할 최대 건수 (기본 6).</summary>
    int TakeLimit => 6;

    Task<List<NewsItem>> FetchAsync(HttpClient http, CancellationToken ct);
}

/// <summary>구글 뉴스 RSS (한국어 / 대한민국 지역) — 검색어 기반 주제 피드</summary>
public sealed class GoogleNewsTopicProvider : INewsProvider
{
    public string Name { get; }
    private readonly string _topic;
    private readonly string _query;
    private readonly string _hl;
    private readonly string _gl;

    public GoogleNewsTopicProvider(string topic, string query, string hl = "ko", string gl = "KR")
    {
        _topic = topic;
        _query = query;
        _hl = hl;
        _gl = gl;
        Name = "google:" + topic;
    }

    public async Task<List<NewsItem>> FetchAsync(HttpClient http, CancellationToken ct)
    {
        var q = Uri.EscapeDataString(_query);
        var lang = _hl == "ko" ? "KR:ko" : "US:en";
        var url = $"https://news.google.com/rss/search?q={q}&hl={_hl}&gl={_gl}&ceid={lang}";
        using var resp = await http.GetAsync(url, ct);
        if (!resp.IsSuccessStatusCode) return new List<NewsItem>();
        var xml = await resp.Content.ReadAsStringAsync(ct);
        return RssParser.Parse(xml, "Google 뉴스", _topic);
    }
}

/// <summary>The Economist 섹션 RSS — 글로벌 풀(econ-*)</summary>
public sealed class EconomistSectionProvider : INewsProvider
{
    public string Name { get; }
    private readonly string _section;
    private readonly string _topic;

    public EconomistSectionProvider(string section)
    {
        _section = section;
        _topic = "econ-" + section.Replace("-", "");
        Name = "economist:" + section;
    }

    public async Task<List<NewsItem>> FetchAsync(HttpClient http, CancellationToken ct)
    {
        var url = $"https://www.economist.com/{_section}/rss.xml";
        using var resp = await http.GetAsync(url, ct);
        if (!resp.IsSuccessStatusCode) return new List<NewsItem>();
        var xml = await resp.Content.ReadAsStringAsync(ct);
        return RssParser.Parse(xml, "The Economist", _topic);
    }
}

/// <summary>
/// New Scientist 섹션 RSS — 글로벌 풀(ns-*).
/// 직접 피드는 일부 클라이언트(curl/node 등)가 406(봇 차단)을 받지만, 이 앱이 쓰는 .NET HttpClient 는
/// 정상 수신한다(2026-09 실측: HTTP 200·섹션당 10건). 실패하면 상태에 err 만 남기고 무시(폴백 대체 없음).
/// </summary>
public sealed class NewsScientistSectionProvider : INewsProvider
{
    public string Name { get; }
    private readonly string _section;
    private readonly string _topic;

    public NewsScientistSectionProvider(string section)
    {
        _section = section;
        _topic = "ns-" + section.Replace("-", "");
        Name = "newscientist:" + section;
    }

    /// <summary>피드가 섹션당 10건을 주므로 전부 반영(수신=반영).</summary>
    public int TakeLimit => 10;

    public async Task<List<NewsItem>> FetchAsync(HttpClient http, CancellationToken ct)
    {
        var url = $"https://www.newscientist.com/subject/{_section}/feed/";
        using var resp = await http.GetAsync(url, ct);
        if (!resp.IsSuccessStatusCode) return new List<NewsItem>();
        var xml = await resp.Content.ReadAsStringAsync(ct);
        return RssParser.Parse(xml, "New Scientist", _topic);
    }
}

/// <summary>
/// 기본 수집 계획 — 관심사(맨시티·비트코인·마인크래프트·조류)는
/// '사진 포함 매체 RSS 우선 + Google 뉴스 보강' 하이브리드로 수집하고,
/// Economist 글로벌 풀(4섹션)과 New Scientist 과학·기술 주제를 더한다.
/// tools/fetch-rss.js 의 스냅샷과 동일한 소스 구성(데모·네이티브 일관).
/// </summary>
public static class DefaultNewsPlan
{
    /// <summary>관심사 토픽 → 하이브리드(매체 피드 + 구글 보강). 사진 포함 매체만 사용.</summary>
    public static readonly HybridTopicProvider[] InterestTopics =
    {
        new("mancity",
            new[]
            {
                new HybridTopicProvider.MediaFeed(
                    "https://www.theguardian.com/football/rss", "The Guardian",
                    new[] { "manchester city", "man city" }),
            },
            new HybridTopicProvider.GoogleFallback("(맨체스터 시티 OR 맨시티 OR MCFC) when:3d", "ko", "KR"),
            take: 6),
        new("bitcoin",
            new[]
            {
                new HybridTopicProvider.MediaFeed(
                    "https://cointelegraph.com/rss", "CoinTelegraph",
                    new[] { "bitcoin", "btc" }),
            },
            new HybridTopicProvider.GoogleFallback("(비트코인 OR \"비트코인 가격\") when:2d", "ko", "KR"),
            take: 6),
        new("minecraft",
            new[]
            {
                new HybridTopicProvider.MediaFeed(
                    "https://www.eurogamer.net/feed", "Eurogamer",
                    new[] { "minecraft", "마인크래프트" }),
                new HybridTopicProvider.MediaFeed(
                    "https://www.pcgamer.com/rss/", "PC Gamer",
                    new[] { "minecraft", "마인크래프트" }),
                new HybridTopicProvider.MediaFeed(
                    "https://www.pcgamesn.com/feed", "PCGamesN",
                    new[] { "minecraft", "마인크래프트" }),
            },
            new HybridTopicProvider.GoogleFallback("(Minecraft OR 마인크래프트 OR Mojang) when:7d -\"Mike Tomlin\" -Steelers", "en", "US"),
            take: 6),
        new("birds",
            new[]
            {
                new HybridTopicProvider.MediaFeed(
                    "https://www.birdwatchingdaily.com/feed/", "BirdWatching Daily",
                    new[] { "bird", "migration", "ornitholog", "species", "owl", "hawk", "nest", "warbler", "cardinal" }),
            },
            new HybridTopicProvider.GoogleFallback("(birding OR birdwatching OR ornithology OR wild birds) when:7d", "en", "US"),
            take: 6),
    };

    public static readonly string[] EconomistSections =
    {
        "business", "science-and-technology", "technology-quarterly", "leaders",
    };

    /// <summary>
    /// New Scientist 주제 피드(.NET 수신 가능). 글로벌 풀(ns-*)로 합류한다.
    /// 주의: curl/node 는 406(봇 차단) — 브라우저 데모 스냅샷 생성기에는 넣지 않는다(폴백 대체 금지 원칙).
    /// </summary>
    public static readonly string[] NewsScientistSections =
    {
        "space", "technology", "health",
    };

    public static List<INewsProvider> CreateProviders()
    {
        var list = new List<INewsProvider>();
        list.AddRange(InterestTopics);
        foreach (var s in EconomistSections) list.Add(new EconomistSectionProvider(s));
        foreach (var s in NewsScientistSections) list.Add(new NewsScientistSectionProvider(s));
        return list;
    }
}

/// <summary>수집 결과 집계(디스크 캐시·UI 상태용)</summary>
public sealed class NewsFetchResult
{
    public List<NewsItem> Items { get; set; } = new();
    public Dictionary<string, string> Status { get; set; } = new(); // providerName -> ok|err
    public DateTime Generated { get; set; } = DateTime.UtcNow;
}
