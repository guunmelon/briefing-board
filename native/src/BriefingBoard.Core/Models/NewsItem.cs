namespace BriefingBoard.Core.Models;

/// <summary>
/// 뉴스 아이템 — 렌더러(rss-snapshot.json 스키마)와 1:1로 호환되는 형태.
/// Host 가 수집하면 이 객체를 JSON 배열로 직렬화해 UI 로 push 한다.
/// </summary>
public sealed class NewsItem
{
    /// <summary>title 해시로 만든 결정적 id (관심없음 기억용)</summary>
    public string Id { get; set; } = "";

    /// <summary>카테고리(f1/ai/stock/fitness/music/global…)</summary>
    public string Cat { get; set; } = "default";

    /// <summary>편집 매칭용 태그</summary>
    public List<string> K { get; set; } = new();

    /// <summary>언론사/피드 이름</summary>
    public string Src { get; set; } = "";

    /// <summary>헤드라인급(편집 선호) 0|1</summary>
    public int H { get; set; }

    public bool Rss { get; set; } = true;

    public string Title { get; set; } = "";

    /// <summary>원문 URL</summary>
    public string Url { get; set; } = "";

    /// <summary>RFC822 발행 시각(그대로 보관, 렌더러가 상대시간 계산)</summary>
    public string Pub { get; set; } = "";

    /// <summary>원문 og:image 캐시 경로 또는 URL (없으면 null)</summary>
    public string? Img { get; set; }

    /// <summary>피드 요약/본문</summary>
    public string Desc { get; set; } = "";

    /// <summary>더 알아볼 검색어</summary>
    public List<string> Rk { get; set; } = new();

    /// <summary>편집자 한 줄 이유</summary>
    public string Why { get; set; } = "";

    /// <summary>어느 관심사 풀로 들어왔는지(google:f1 / economist:business…)</summary>
    public string Topic { get; set; } = "";

    public string Kind { get; set; } = "rss";

    /// <summary>메타 갱신용 임시 여부</summary>
    public bool Seed { get; set; }

    public static string HashId(string s)
    {
        unchecked
        {
            uint x = 0;
            foreach (char c in s) x = x * 31 + c;
            return x.ToString("x");
        }
    }
}
