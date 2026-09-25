using BriefingBoard.Core.Models;
using BriefingBoard.Core.Rss;

namespace BriefingBoard.Core.News;

/// <summary>
/// 수집 실행기 — 여러 공급자(Google 주제·Economist 섹션)를 순회해 결과를 모은다.
/// 각 토픽의 첫 기사에 헤드라인(h=1) 마킹, 생성 시각 기록, 중복 기사 제거.
/// </summary>
public sealed class NewsCollector
{
    private readonly HttpClient _http;

    public NewsCollector(HttpClient http)
    {
        _http = http;
        if (string.IsNullOrEmpty(_http.DefaultRequestHeaders.UserAgent.ToString()))
        {
            _http.DefaultRequestHeaders.UserAgent.ParseAdd(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) BriefingBoard/1.0");
        }
        _http.Timeout = TimeSpan.FromSeconds(20);
    }

    public static HttpClient CreateHttp() => new();

    public async Task<NewsFetchResult> CollectAsync(
        IEnumerable<INewsProvider> providers,
        CancellationToken ct,
        int? takePerProvider = null,
        int delayMsBetween = 400)
    {
        var result = new NewsFetchResult { Generated = DateTime.UtcNow };
        var seenIds = new HashSet<string>();

        foreach (var provider in providers)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var items = await provider.FetchAsync(_http, ct);
                var take = takePerProvider ?? provider.TakeLimit;   // 제공자별 반영 상한
                var grouped = items
                    .GroupBy(i => i.Topic)
                    .Select(g => g.ToList())
                    .ToList();

                foreach (var topicItems in grouped)
                {
                    var taken = topicItems.Take(take).ToList();
                    if (taken.Count > 0) taken[0].H = 1;
                    foreach (var it in taken)
                    {
                        if (!seenIds.Add(it.Id)) continue;
                        result.Items.Add(it);
                    }
                }
                result.Status[provider.Name] = $"ok:{items.Count}";
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception e)
            {
                result.Status[provider.Name] = "err:" + (e.Message.Length > 60 ? e.Message[..60] : e.Message);
            }

            if (delayMsBetween > 0)
            {
                try { await Task.Delay(delayMsBetween, ct); } catch (OperationCanceledException) { throw; }
            }
        }
        return result;
    }
}
