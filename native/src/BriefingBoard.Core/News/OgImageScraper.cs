using System.Text.RegularExpressions;
using BriefingBoard.Core.Text;

namespace BriefingBoard.Core.News;

/// <summary>
/// 기사 원문에서 og:image / og:description 을 1~2회 GET 으로 스크랩한다.
///  - RSS 자체에 이미지가 없어도(실측) 최종 카드 썸네일·한 줄 설명을 이 경로로 채운다.
///  - 구글뉴스 리다이렉트 링크(news.google.com/rss/articles/…)는 최종 원문 주소를 추적한 뒤 스크랩한다.
///  - 차단 우회: 브라우저 UA + Accept-Language + 원문 오리진 Referer 헤더 사용.
///  - 실패/타임아웃은 null → UI가 그라데이션 폴백.
/// </summary>
public sealed partial class OgImageScraper
{
    private readonly HttpClient _http;

    public OgImageScraper(HttpClient http)
    {
        _http = http;
        if (string.IsNullOrEmpty(_http.DefaultRequestHeaders.UserAgent.ToString()))
        {
            _http.DefaultRequestHeaders.UserAgent.ParseAdd(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36");
        }
    }

    public record MetaResult(string? Img, string? Desc);

    /// <summary>호환용 — 이미지만 원할 때.</summary>
    public Task<string?> ScrapeAsync(string articleUrl, CancellationToken ct, TimeSpan? timeout = null)
        => ScrapeMetaAsync(articleUrl, ct, timeout).ContinueWith(t => t.Result?.Img, ct, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);

    public async Task<MetaResult?> ScrapeMetaAsync(string articleUrl, CancellationToken ct, TimeSpan? timeout = null)
    {
        timeout ??= TimeSpan.FromSeconds(10);
        if (!Uri.TryCreate(articleUrl, UriKind.Absolute, out var uri) ||
            (uri.Scheme != "http" && uri.Scheme != "https")) return null;
        try
        {
            // 1) 구글뉴스 리다이렉트면 최종 원문 주소 먼저 확보.
            //    최종 주소를 못 찾아도 그 구글 페이지 자체의 og:image(기사 대표 썸네일)는 쓸 수 있어 폴백으로 유지한다.
            var target = uri;
            bool isGoogle = uri.Host.IndexOf("news.google.com", StringComparison.OrdinalIgnoreCase) >= 0;
            bool googleFallback = false;
            if (isGoogle)
            {
                var finalUrl = await ResolveGoogleFinalAsync(uri, timeout.Value, ct);
                if (finalUrl is not null) target = finalUrl;
                else googleFallback = true;   // 최종 URL 불명 → 페이지 자체 og 이미지만 사용
            }
            var html = await FetchHeadHtmlAsync(target, timeout.Value, ct);
            if (string.IsNullOrEmpty(html)) return null;

            var img = OgImageRegex().Match(html).Groups[1].Value;
            if (string.IsNullOrWhiteSpace(img))
                img = OgImageAltOrderRegex().Match(html).Groups[1].Value; // content 먼저 오는 변형
            if (string.IsNullOrWhiteSpace(img))
                img = ImageSrcLinkRegex().Match(html).Groups[1].Value;

            var desc = OgDescRegex().Match(html).Groups[1].Value;
            if (string.IsNullOrWhiteSpace(desc))
                desc = MetaDescRegex().Match(html).Groups[1].Value;

            img = Clean(img); desc = Clean(desc);
            // 구글 리다이렉트 페이지 설명은 “Google 뉴스가 종합한…” 범용 문구 — 한 줄 요약 재료로 쓰지 않는다
            if (googleFallback || desc.Contains("Google 뉴스", StringComparison.OrdinalIgnoreCase) ||
                desc.Contains("종합한", StringComparison.OrdinalIgnoreCase)) desc = "";
            var absImg = Absolutize(target, img);
            return new MetaResult(absImg, desc.Length >= 12 ? desc[..Math.Min(320, desc.Length)] : null);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>구글뉴스 articles 리다이렉트 페이지에서 최종 원문 URL(og:url / canonical / data-n-au)을 찾는다.</summary>
    private async Task<Uri?> ResolveGoogleFinalAsync(Uri googleUri, TimeSpan timeout, CancellationToken ct)
    {
        try
        {
            var html = await FetchHeadHtmlAsync(googleUri, timeout, ct, maxBytes: 4_000_000);
            if (string.IsNullOrEmpty(html)) return null;
            var cand = OgUrlRegex().Match(html).Groups[1].Value;
            if (string.IsNullOrWhiteSpace(cand)) cand = CanonicalRegex().Match(html).Groups[1].Value;
            if (string.IsNullOrWhiteSpace(cand)) cand = DataNAuRegex().Match(html).Groups[1].Value;
            cand = Clean(cand);
            if (string.IsNullOrEmpty(cand) || cand.IndexOf("news.google.com", StringComparison.OrdinalIgnoreCase) >= 0) return null;
            if (Uri.TryCreate(cand, UriKind.Absolute, out var abs) && (abs.Scheme == "http" || abs.Scheme == "https")) return abs;
            return null;
        }
        catch { return null; }
    }

    private static string Clean(string v)
    {
        v = (v ?? "").Trim().Replace("&amp;", "&").Replace("&#x2F;", "/").Replace("&#x2f;", "/").Replace("&#39;", "'").Replace("&quot;", "\"");
        v = TagRegex().Replace(v, " ");
        v = System.Net.WebUtility.HtmlDecode(v); // &nbsp; 등 엔티티까지 정리
        return v.Trim();
    }

    private static string? Absolutize(Uri baseUri, string maybeRel)
    {
        if (string.IsNullOrEmpty(maybeRel)) return null;
        if (Uri.TryCreate(baseUri, maybeRel, out var abs)) return abs.ToString();
        if (Uri.TryCreate(maybeRel, UriKind.Absolute, out var direct)) return direct.ToString();
        return null;
    }

    /// <summary>원문 html 본문 일부만 읽는다(과도한 다운로드 방지). 리다이렉트 추적 + 헤더로 차단 우회 시도.</summary>
    private async Task<string?> FetchHeadHtmlAsync(Uri uri, TimeSpan timeout, CancellationToken ct, int maxBytes = 3_500_000)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(timeout);
        using var req = new HttpRequestMessage(HttpMethod.Get, uri);
        req.Headers.TryAddWithoutValidation("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
        req.Headers.TryAddWithoutValidation("Accept-Language", "ko,en;q=0.8");
        req.Headers.TryAddWithoutValidation("Referer", uri.Scheme + "://" + uri.Host + "/");
        using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, timeoutCts.Token);
        if (!resp.IsSuccessStatusCode) return null;
        await using var stream = await resp.Content.ReadAsStreamAsync(timeoutCts.Token);
        using var reader = new StreamReader(stream);
        var buf = new char[maxBytes];
        int read = 0;
        while (read < buf.Length)
        {
            var chunk = await reader.ReadAsync(buf.AsMemory(read, buf.Length - read), timeoutCts.Token);
            if (chunk <= 0) break;
            read += chunk;
        }
        return new string(buf, 0, read);
    }

    [GeneratedRegex("<meta[^>]+property=[\"'](?:og:image|twitter:image)[\"'][^>]+content=[\"']([^\"']+)[\"']", RegexOptions.IgnoreCase)]
    private static partial Regex OgImageRegex();
    [GeneratedRegex("<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+property=[\"'](?:og:image|twitter:image)[\"']", RegexOptions.IgnoreCase)]
    private static partial Regex OgImageAltOrderRegex();
    [GeneratedRegex("<link[^>]+rel=[\"']image_src[\"'][^>]+href=[\"']([^\"']+)[\"']", RegexOptions.IgnoreCase)]
    private static partial Regex ImageSrcLinkRegex();
    [GeneratedRegex("<meta[^>]+property=[\"']og:description[\"'][^>]+content=[\"']([^\"']+)[\"']", RegexOptions.IgnoreCase)]
    private static partial Regex OgDescRegex();
    [GeneratedRegex("<meta[^>]+name=[\"']description[\"'][^>]+content=[\"']([^\"']+)[\"']", RegexOptions.IgnoreCase)]
    private static partial Regex MetaDescRegex();
    [GeneratedRegex("<meta[^>]+property=[\"']og:url[\"'][^>]+content=[\"']([^\"']+)[\"']", RegexOptions.IgnoreCase)]
    private static partial Regex OgUrlRegex();
    [GeneratedRegex("<link[^>]+rel=[\"']canonical[\"'][^>]+href=[\"']([^\"']+)[\"']", RegexOptions.IgnoreCase)]
    private static partial Regex CanonicalRegex();
    [GeneratedRegex("data-n-au=[\"']([^\"']+)[\"']", RegexOptions.IgnoreCase)]
    private static partial Regex DataNAuRegex();
    [GeneratedRegex("<[^>]+>", RegexOptions.IgnoreCase)]
    private static partial Regex TagRegex();
}
