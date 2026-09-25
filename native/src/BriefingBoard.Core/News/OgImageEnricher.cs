using BriefingBoard.Core.Models;

namespace BriefingBoard.Core.News;

/// <summary>
/// 뉴스 아이템 목록에 og:image 썸네일을 '무거운 작업 제한'으로 채운다.
///  - 후보: Img 가 비어 있고 RSS 원문 URL 이 있는 아이템
///  - 우선순위: 헤드라인(h=1) 먼저, 그다음 나머지(제목순)
///  - 제한: maxAttempts 개수 / perLink 링크당 타임아웃 / totalCap 전체 상한
///  - attempted 집합을 주면 이미 시도한 URL(성공·실패 모두)은 건너뜀 → 폴링이 부담 없음
/// 실패/타임아웃은 null 유지 → 렌더러가 그라데이션+아이콘으로 폴백한다.
/// </summary>
public static class OgImageEnricher
{
    public static async Task<int> EnrichAsync(
        HttpClient http,
        IReadOnlyList<NewsItem> items,
        ISet<string>? attempted,
        CancellationToken ct,
        int maxAttempts = 9,
        TimeSpan? perLink = null,
        TimeSpan? totalCap = null)
    {
        perLink ??= TimeSpan.FromSeconds(8);
        totalCap ??= TimeSpan.FromSeconds(30);
        if (items.Count == 0 || maxAttempts <= 0) return 0;

        var scraper = new OgImageScraper(http);
        var deadline = DateTime.UtcNow + totalCap.Value;

        var candidates = items
            .Where(i => i.Rss && string.IsNullOrEmpty(i.Img) && !string.IsNullOrEmpty(i.Url))
            .OrderByDescending(i => i.H == 1)
            .ThenBy(i => i.Title, StringComparer.Ordinal)
            .ToList();

        int attempts = 0;
        foreach (var it in candidates)
        {
            if (attempts >= maxAttempts) break;
            if (DateTime.UtcNow > deadline) break;
            if (attempted != null && !attempted.Add(it.Url)) continue;   // 이미 시도(성공/실패)

            try
            {
                using var linkCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                linkCts.CancelAfter(perLink.Value);
                var meta = await scraper.ScrapeMetaAsync(it.Url, linkCts.Token, perLink);
                if (meta is not null)
                {
                    if (!string.IsNullOrEmpty(meta.Img)) it.Img = meta.Img;
                    // 구글뉴스처럼 RSS desc 가 링크뿐인 기사는 실제 본문 설명(og:description)으로 채운다 → 한 줄 요약 재료
                    if (!string.IsNullOrEmpty(meta.Desc) && string.IsNullOrWhiteSpace(it.Desc)) it.Desc = meta.Desc;
                }
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested) { }
            catch { /* 개별 실패는 무시 — 다음 폴링에서 재시도 안 함 */ }
            attempts++;
        }
        return attempts;
    }
}
