using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using System.Xml;
using BriefingBoard.Core.Models;
using BriefingBoard.Core.Text;

namespace BriefingBoard.Core.ICloud;

/// <summary>iCloud 캘린더(CalDAV) — 읽기 전용 동기화 클라이언트.</summary>
public sealed class CalDavClient
{
    private readonly HttpClient _http;
    private readonly string _email;

    public const string Server = "https://caldav.icloud.com";

    public CalDavClient(string appleIdEmail, string appSpecificPassword)
    {
        _email = appleIdEmail;
        _http = new HttpClient { BaseAddress = new Uri(Server), Timeout = TimeSpan.FromSeconds(25) };
        var cred = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{appleIdEmail}:{appSpecificPassword}"));
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", cred);
        _http.DefaultRequestHeaders.Add("User-Agent", "BriefingBoard/1.0 (Windows; read-only CalDAV)");
    }

    private sealed record CalendarInfo(string Href, string DisplayName);

    // ---------------- 캘린더 발견 ----------------

    public async Task<IReadOnlyList<CalCalendar>> DiscoverCalendarsAsync(CancellationToken ct)
    {
        // 1) 현재 사용자 principal
        var principal = await FindHrefAsync(
            "/", "<d:current-user-principal/>", "current-user-principal", ct);
        if (string.IsNullOrEmpty(principal))
            throw new InvalidOperationException("iCloud 계정 인증/발견에 실패했어요 (이메일·앱 특수 암호 확인).");

        // 2) calendar-home-set
        var home = await FindHrefAsync(
            principal, "<d:calendar-home-set/>", "calendar-home-set", ct);
        if (string.IsNullOrEmpty(home)) return Array.Empty<CalCalendar>();

        // 3) 홈 아래 캘린더 목록
        const string propfind =
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
            "<d:propfind xmlns:d=\"DAV:\" xmlns:cs=\"http://calendarserver.org/ns/\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\">" +
            "<d:prop><d:displayname/><c:supported-calendar-component-set/></d:prop></d:propfind>";

        var xml = await RequestAsync("PROPFIND", home, propfind, "1", ct);
        var doc = ParseXml(xml);
        var result = new List<CalCalendar>();
        foreach (var resp in doc.Descendants(XName.Get("response", "DAV:")))
        {
            var href = CleanHref(FindText(resp, "href", "DAV:") ?? "");
            var display = FindText(resp, "displayname", "DAV:")?.Trim();
            var compSet = resp.Descendants(XName.Get("supported-calendar-component-set", "urn:ietf:params:xml:ns:caldav")).FirstOrDefault();
            var hasVevent = compSet != null && compSet.Descendants().Any(e => (e.Attribute("name")?.Value ?? "") == "VEVENT");
            if (string.IsNullOrEmpty(href) || (!hasVevent && compSet != null)) continue;
            result.Add(new CalCalendar { Href = href, DisplayName = string.IsNullOrEmpty(display) ? href.Split('/').Where(s => s.Length > 0).LastOrDefault() ?? "캘린더" : display });
        }
        return result;
    }

    private async Task<string?> FindHrefAsync(string path, string body, string propName, CancellationToken ct)
    {
        var xml = await RequestAsync("PROPFIND", path, WrapPropfind(body), "0", ct);
        var doc = ParseXml(xml);
        var target = doc.Descendants()
            .FirstOrDefault(e => e.Name.LocalName == propName &&
                                 (e.Name.NamespaceName == "DAV:" || e.Name.NamespaceName == "urn:ietf:params:xml:ns:caldav" || e.Name.NamespaceName == "http://calendarserver.org/ns/"));
        var href = target?.Element(XName.Get("href", "DAV:"))?.Value;
        return string.IsNullOrEmpty(href) ? null : CleanHref(href);
    }

    private static string WrapPropfind(string innerProp) =>
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
        "<d:propfind xmlns:d=\"DAV:\"><d:prop>" + innerProp + "</d:prop></d:propfind>";

    // ---------------- 일정 범위 조회 ----------------

    /// <summary>[from, to) 범위의 일정을 조회해 단일 인스턴스로 반환(반복 규칙 확장 포함).</summary>
    public async Task<IReadOnlyList<CalEvent>> QueryEventsAsync(
        CalCalendar calendar, DateTime from, DateTime to, CancellationToken ct)
    {
        var timeRange = $"<c:time-range start=\"{FormatIcs(from)}\" end=\"{FormatIcs(to)}\"/>";
        var report =
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
            "<c:calendar-query xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\">" +
            "<d:prop><d:getetag/><c:calendar-data/></d:prop>" +
            "<c:filter><c:comp-filter name=\"VCALENDAR\"><c:comp-filter name=\"VEVENT\">" +
            timeRange +
            "</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>";

        var xml = await RequestAsync("REPORT", calendar.Href, report, "1", ct);
        var doc = ParseXml(xml);

        var events = new List<CalEvent>();
        foreach (var resp in doc.Descendants(XName.Get("response", "DAV:")))
        {
            var data = resp.Descendants(XName.Get("calendar-data", "urn:ietf:params:xml:ns:caldav")).FirstOrDefault()?.Value;
            if (string.IsNullOrEmpty(data)) continue;
            var veventText = NormalizeCalendarData(data);
            if (string.IsNullOrEmpty(veventText)) continue;

            var ev = new CalEvent { Calendar = calendar.DisplayName };
            ParseVevent(veventText, ev);

            // 반복(RRULE)이 있으면 범위 안 다음 발생들로 확장
            var master = VEventProp(veventText, "RRULE");
            if (!string.IsNullOrEmpty(master))
            {
                var occurrences = Recurrence.Expand(ev, master, from, to, calendar.DisplayName);
                events.AddRange(occurrences);
            }
            else if (ev.Start <= to && ev.End >= from)
            {
                events.Add(ev);
            }
        }
        return events;
    }

    /// <summary>calendar-data 가 XML(중첩 VEVENT)이면 line 형태로, 아니면 그대로 반환.</summary>
    private static string NormalizeCalendarData(string data)
    {
        var trimmed = data.TrimStart();
        if (!trimmed.StartsWith("<", StringComparison.Ordinal)) return data;

        try
        {
            var doc = ParseXml(data);
            var vevent = doc.Descendants().FirstOrDefault(e => e.Name.LocalName == "VEVENT");
            if (vevent == null) return "";
            var sb = new StringBuilder();
            foreach (var child in vevent.Elements())
            {
                var name = child.Name.LocalName.ToUpperInvariant();
                var parts = new List<string>();
                var valueAttr = child.Attribute("value")?.Value;
                var tzAttr = child.Attribute("tzid")?.Value;
                if (!string.IsNullOrEmpty(valueAttr)) parts.Add($"VALUE={valueAttr}");
                if (!string.IsNullOrEmpty(tzAttr)) parts.Add($"TZID={tzAttr}");
                var head = parts.Count > 0 ? $"{name};{string.Join(";", parts)}" : name;
                sb.AppendLine($"{head}:{child.Value.Replace("\n", " ").Trim()}");
            }
            return sb.ToString();
        }
        catch
        {
            return "";
        }
    }

    private void ParseVevent(string text, CalEvent ev)
    {
        foreach (var line in text.Split('\n'))
        {
            var l = line.Trim();
            if (l.StartsWith("UID:", StringComparison.Ordinal)) ev.Uid = l[4..].Trim();
            else if (l.StartsWith("SUMMARY:", StringComparison.Ordinal)) ev.Title = Unfold(l[8..]).Trim();
            else if (l.StartsWith("LOCATION:", StringComparison.Ordinal)) ev.Location = Unfold(l[9..]).Trim();
            else if (l.StartsWith("DTSTART", StringComparison.Ordinal)) ParseDt(l, true, ev);
            else if (l.StartsWith("DTEND", StringComparison.Ordinal)) ParseDt(l, false, ev);
        }

        if (ev.End <= ev.Start) ev.End = ev.Start.AddHours(1);
        if (ev.AllDay && ev.End <= ev.Start.AddHours(23)) ev.End = ev.Start.AddDays(1);

        ev.Id = NewsItem.HashId(ev.Uid + ev.Start.ToString("o") + ev.Title);
        if (string.IsNullOrEmpty(ev.Title)) ev.Title = "(제목 없음)";

        // 종류 추정
        var t = ev.Title;
        ev.Kind = t.Contains("미팅") || t.Contains("회의") || t.Contains("리뷰") || t.Contains("면담") ? "meet"
            : t.Contains("운동") || t.Contains("러닝") || t.Contains("조깅") || t.Contains("PT") || t.Contains("헬스") ? "health"
            : t.Contains("기획") || t.Contains("개발") || t.Contains("리서치") || t.Contains("작업") || t.Contains("스프린트") ? "work"
            : "personal";
        ev.Icon = ev.Kind switch { "meet" => "i-chat", "work" => "i-flag", "health" => "i-heart", _ => "i-cal" };
        ev.Meta = string.Join(" · ", new[] { ev.Location }.Where(x => !string.IsNullOrEmpty(x)));
    }

    private void ParseDt(string line, bool isStart, CalEvent ev)
    {
        // DTSTART;TZID=Asia/Seoul:20260908T090000 / DTSTART:20260908T090000Z / DTSTART;VALUE=DATE:20260908
        var body = line[(line.IndexOf(':') + 1)..];
        var valueDate = line.Contains("VALUE=DATE", StringComparison.OrdinalIgnoreCase) && !body.Contains("T", StringComparison.Ordinal);
        var style = body.EndsWith("Z", StringComparison.Ordinal) ? "Z" : (valueDate ? "D" : "L");
        DateTime dt;
        switch (style)
        {
            case "Z": dt = DateTime.ParseExact(body, "yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal); break;
            case "D": dt = DateTime.ParseExact(body, "yyyyMMdd", CultureInfo.InvariantCulture); break;
            default:
                if (body.Length >= 15) dt = DateTime.ParseExact(body, "yyyyMMdd'T'HHmmss", CultureInfo.InvariantCulture);
                else dt = DateTime.ParseExact(body, "yyyyMMdd'T'HHmm", CultureInfo.InvariantCulture);
                break;
        }
        var k = DateTimeKind.Utc;
        if (isStart)
        {
            ev.Start = DateTime.SpecifyKind(dt, style == "L" ? DateTimeKind.Local : DateTimeKind.Utc).ToUniversalTime();
            ev.AllDay = style == "D";
        }
        else
        {
            ev.End = DateTime.SpecifyKind(dt, style == "L" ? DateTimeKind.Local : DateTimeKind.Utc).ToUniversalTime();
        }
        _ = k;
    }

    private static string Unfold(string v) => v.Replace("\\,", ",").Replace("\\;", ";").Replace("\\n", " ");

    private string? FindText(XElement parent, string local, string ns)
    {
        var e = parent.Descendants(XName.Get(local, ns)).FirstOrDefault();
        return e?.Value;
    }

    private static string CleanHref(string href)
    {
        var h = href;
        if (h.StartsWith(Server, StringComparison.OrdinalIgnoreCase)) h = h[Server.Length..];
        return h.StartsWith("/", StringComparison.Ordinal) ? h : "/" + h;
    }

    private static string FormatIcs(DateTime dt) => dt.ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);

    private static XDocument ParseXml(string xml)
    {
        var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Ignore };
        using var sr = new StringReader(xml);
        using var xr = XmlReader.Create(sr, settings);
        return XDocument.Load(xr);
    }

    private static string VEventProp(string text, string name)
    {
        foreach (var line in text.Split('\n'))
        {
            var l = line.Trim();
            if (l.StartsWith(name + ":", StringComparison.OrdinalIgnoreCase)) return l[(name.Length + 1)..].Trim();
        }
        return "";
    }

    private async Task<string> RequestAsync(string method, string path, string body, string depth, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(new HttpMethod(method), path);
        req.Headers.Add("Depth", depth);
        if (!string.IsNullOrEmpty(body))
        {
            req.Content = new StringContent(body, Encoding.UTF8, "application/xml; charset=utf-8");
        }
        using var resp = await _http.SendAsync(req, ct);
        var text = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"{method} {path} → HTTP {(int)resp.StatusCode} ({resp.ReasonPhrase})");
        }
        return text;
    }
}

public sealed class CalCalendar
{
    public string Href { get; set; } = "";
    public string DisplayName { get; set; } = "캘린더";
}
