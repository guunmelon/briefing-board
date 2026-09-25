using System.Text.RegularExpressions;
using System.Xml.Linq;
using System.Xml;
using BriefingBoard.Core.Models;
using BriefingBoard.Core.Text;

namespace BriefingBoard.Core.Rss;

/// <summary>
/// Google 뉴스 RSS / The Economist RSS 공용 파서.
/// item 의 title·link·pubDate·description·source(일부 피드)를 추출한다.
/// </summary>
public static partial class RssParser
{
    public static List<NewsItem> Parse(string xml, string defaultSrc, string topicKey)
    {
        var result = new List<NewsItem>();
        XDocument? doc;
        try
        {
            var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Ignore };
            using var sr = new StringReader(xml);
            using var xr = XmlReader.Create(sr, settings);
            doc = XDocument.Load(xr);
        }
        catch
        {
            return result; // 파싱 실패 시 빈 결과
        }

        var channel = doc.Descendants().FirstOrDefault(e => e.Name.LocalName == "channel");
        var feedTitle = Clean(channel?.Element("title")?.Value ?? defaultSrc);
        var itemNodes = doc.Descendants().Where(e => e.Name.LocalName == "item").ToList();

        foreach (var item in itemNodes)
        {
            var title = Clean(item.Element("title")?.Value ?? "");
            var link = Clean(item.Element("link")?.Value ?? "");
            var pub = Clean(item.Element("pubDate")?.Value ?? "");
            var desc = Clean(item.Element("description")?.Value ?? "").Clip(360);
            var source = Clean(item.Element("source")?.Value ?? "");

            string? img = null;
            // media:content/thumbnail 후보 중 가장 큰(width 최대) 사진을 고른다
            var mediaEls = item.Elements().Where(e =>
                e.Name.LocalName is "content" or "thumbnail" &&
                (e.Name.NamespaceName.Contains("media", StringComparison.OrdinalIgnoreCase) ||
                 e.Name.NamespaceName.Contains("mrss", StringComparison.OrdinalIgnoreCase))).ToList();
            if (mediaEls.Count > 0)
            {
                var best = mediaEls
                    .OrderByDescending(e =>
                    {
                        var w = e.Attribute("width")?.Value ?? e.Attribute("medium")?.Value;
                        return int.TryParse(w, out var n) ? n : 0;
                    })
                    .FirstOrDefault(e => !string.IsNullOrEmpty(e.Attribute("url")?.Value));
                img = best?.Attribute("url")?.Value;
            }
            if (string.IsNullOrEmpty(img))
            {
                var m = ImgTagRegex().Match(item.ToString());
                img = m.Success ? m.Groups[1].Value : null;
            }

            if (string.IsNullOrWhiteSpace(title) || string.IsNullOrWhiteSpace(link)) continue;
            var src = !string.IsNullOrEmpty(source) ? source : feedTitle;

            // Google 뉴스는 제목 끝에 ' - 언론사' 를 붙여 반환한다.
            var suffix = " - " + src;
            var t = title;
            if (!string.IsNullOrEmpty(src) && t.EndsWith(suffix, StringComparison.Ordinal))
                t = t[..^suffix.Length];

            result.Add(new NewsItem
            {
                Id = NewsItem.HashId(topicKey + "|" + t.Trim()),
                Cat = CatFromTopic(topicKey),
                K = TagsFor(topicKey),
                Src = src,
                H = 0,
                Title = t.Trim(),
                Url = link,
                Pub = pub,
                Desc = desc,
                Img = string.IsNullOrEmpty(img) ? null : img.Replace("&amp;", "&"),
                Topic = topicKey,
                Kind = "rss",
                Why = WhyFor(topicKey, src),
                Rk = FollowUpsFor(topicKey),
            });
        }
        return result;
    }

    public static string Clean(string? s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        var v = s.Replace("<![CDATA[", "").Replace("]]>", "");
        v = v.Replace("&amp;", "&").Replace("&lt;", "<").Replace("&gt;", ">")
             .Replace("&quot;", "\"").Replace("&#39;", "'").Replace("&apos;", "'");
        v = HtmlTagRegex().Replace(v, " ");
        v = Regex.Replace(v, @"\s+", " ").Trim();
        return v;
    }

    [GeneratedRegex("<[^>]+>")]
    private static partial Regex HtmlTagRegex();

    [GeneratedRegex("<img[^>]+src=[\"']([^\"']+)[\"']", RegexOptions.IgnoreCase)]
    private static partial Regex ImgTagRegex();

    private static string CatFromTopic(string topic) => topic switch
    {
        "f1" => "f1",
        "ai" => "ai",
        "stock" => "stock",
        "fitness" => "fitness",
        "music" => "music",
        "mancity" => "sport",
        "bitcoin" => "crypto",
        "minecraft" => "game",
        "birds" => "nature",
        _ when topic.StartsWith("ns-") => "science",
        _ when topic.StartsWith("econ-") => "global",
        _ => "default",
    };

    private static List<string> TagsFor(string topic) => topic switch
    {
        "f1" => new() { "f1", "포뮬러", "페라리", "맥라렌", "메르세데스", "레이싱", "모터스포츠", "그랑프리", "드라이버", "서킷", "안토넬리" },
        "ai" => new() { "ai", "인공지능", "생성형", "모델", "에이전트", "gpt", "llm", "딥러닝", "빅테크" },
        "stock" => new() { "삼성전자", "삼성", "반도체", "tsmc", "메모리", "수출", "주식", "코스피", "실적" },
        "fitness" => new() { "러닝", "운동", "달리기", "조깅", "런닝", "헬스", "걷기", "마라톤" },
        "music" => new() { "음악", "장르", "차트", "밴드", "가수", "앨범", "콘서트", "스트리밍" },
        "mancity" => new() { "맨시티", "맨체스터 시티", "맨체스터", "mcfc", "홀란", "프리미어리그", "epl", "축구", "챔피언스리그", "과르디올라" },
        "bitcoin" => new() { "비트코인", "비트코인 가격", "btc", "암호화폐", "가상자산", "코인", "이더리움", "알트코인", "업비트" },
        "minecraft" => new() { "마인크래프트", "minecraft", "모장", "마크", "샌드박스", "게임", "레드스톤", "업데이트" },
        "birds" => new() { "조류", "새", "철새", "탐조", "버드워칭", "birdwatching", "조류 관찰", "야생동물", "앵무새", "맹금류", "둥지" },
        _ when topic.StartsWith("ns-") => new() { "과학", "기술", "우주", "연구", "space", "nasa", "물리", "생물", "유전자", "기후", "뇌과학", "건강" },
        _ when topic.StartsWith("econ-") => new() { "경제", "글로벌", "해외", "세계", "국제", "과학", "기술", "투자", "국제경제" },
        _ => new(),
    };

    private static string WhyFor(string topic, string src) => topic switch
    {
        "f1" => "F1 관심사에 딱 맞는 최신 레이스·팀 소식이에요.",
        "ai" => "AI 흐름을 따라가는 데 바로 도움이 되는 소식이에요.",
        "stock" => "반도체·시장 관심과 이어지는 실제 뉴스예요.",
        "fitness" => "운동 루틴과 연결해 읽을 수 있는 소식이에요.",
        "music" => "음악 취향의 지금 흐름을 보여주는 소식이에요.",
        "mancity" => "맨시티 팬으로서 놓치면 안 되는 경기·이적 소식이에요.",
        "bitcoin" => "비트코인·코인 시장의 흐름을 바꾸는 새 소식이에요.",
        "minecraft" => "마인크래프트 세계에서 방금 일어난 일이에요.",
        "birds" => "조류·자연을 좋아하는 사람에게 흥미로운 발견 소식이에요.",
        _ when topic.StartsWith("ns-") => "New Scientist가 전하는 과학·기술 최신 소식이에요.",
        _ when topic.StartsWith("econ-") => "The Economist가 엄선한 글로벌 심층 소식이에요. 해외 동향을 읽고 싶을 때 좋습니다.",
        _ => (string.IsNullOrEmpty(src) ? "이 매체" : src) + "에서 전한 최신 소식이에요.",
    };

    private static List<string> FollowUpsFor(string topic) => topic switch
    {
        _ when topic.StartsWith("econ-") => new() { "The Economist 최신 보도", "관련 글로벌 후속" },
        _ => new() { topic + " 최신 소식", "관련 후속 보도" },
    };
}
