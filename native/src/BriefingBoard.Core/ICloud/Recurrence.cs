using System.Globalization;
using BriefingBoard.Core.Models;

namespace BriefingBoard.Core.ICloud;

/// <summary>
/// RRULE 을 최소 지원 범위로 해석해 (DAILY/WEEKLY/MONTHLY, INTERVAL, COUNT, UNTIL, BYDAY)
/// 지정 기간 안의 다음 발생 인스턴스들을 만들어 반환한다.
/// (읽기 전용 목록 표시용 — 복잡한 예외 규칙은 미지원, 실제 검증 시 보정)
/// </summary>
public static class Recurrence
{
    public static List<CalEvent> Expand(CalEvent master, string rrule, DateTime from, DateTime to, string calName)
    {
        var list = new List<CalEvent>();
        var freq = "DAILY";
        var interval = 1;
        long count = long.MaxValue;
        DateTime? until = null;
        var byday = new HashSet<string>();

        foreach (var part in rrule.Split(';'))
        {
            var kv = part.Split('=', 2);
            if (kv.Length != 2) continue;
            var k = kv[0].ToUpperInvariant();
            var v = kv[1].ToUpperInvariant();
            switch (k)
            {
                case "FREQ": freq = v; break;
                case "INTERVAL": int.TryParse(v, out interval); break;
                case "COUNT": long.TryParse(v, out count); break;
                case "UNTIL":
                    until = v.EndsWith("Z")
                        ? DateTime.ParseExact(v, "yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal)
                        : DateTime.ParseExact(v, "yyyyMMdd'T'HHmmss", CultureInfo.InvariantCulture);
                    break;
                case "BYDAY":
                    foreach (var d in v.Split(',')) byday.Add(d.Trim('-'));
                    break;
            }
        }
        if (interval < 1) interval = 1;

        var duration = master.End - master.Start;
        if (duration <= TimeSpan.Zero) duration = TimeSpan.FromMinutes(60);

        // 시작일 ~ 조회 종료까지 후보를 만들되, 너무 많은 반복은 방지(10년 이내만)
        var searchEnd = to < master.Start.AddYears(10) ? to : master.Start.AddYears(10);
        var cursor = master.Start;
        long made = 0;
        var safety = 0;

        while (cursor <= searchEnd && made < count && safety < 4000)
        {
            safety++;
            if (freq == "MONTHLY")
            {
                if (!(cursor >= from - TimeSpan.FromDays(1) && cursor <= to)) { AddMonth(ref cursor, interval); continue; }
                if (cursor >= from) list.Add(Clone(master, cursor, duration, calName, made));
                made++;
                AddMonth(ref cursor, interval);
                continue;
            }

            if (freq == "WEEKLY")
            {
                var weekStart = StartOfWeek(cursor);
                if (byday.Count > 0)
                {
                    for (var i = 0; i < 7; i++)
                    {
                        var day = weekStart.AddDays(i);
                        var dayName = day.DayOfWeek.ToString().Substring(0, 2).ToUpperInvariant();
                        if (!byday.Contains(dayName)) continue;
                        var occ = new DateTime(day.Year, day.Month, day.Day, master.Start.Hour, master.Start.Minute, 0, master.Start.Kind);
                        if (occ >= from - TimeSpan.FromDays(1) && occ <= to && occ >= cursor.AddDays(-7))
                        {
                            if (occ >= from) list.Add(Clone(master, occ, duration, calName, made));
                            made++;
                        }
                    }
                    cursor = weekStart.AddDays(7 * interval);
                    continue;
                }

                if (cursor >= from && cursor <= to) list.Add(Clone(master, cursor, duration, calName, made));
                made++;
                cursor = cursor.AddDays(7 * interval);
                continue;
            }

            // DAILY
            if (cursor >= from && cursor <= to) list.Add(Clone(master, cursor, duration, calName, made));
            made++;
            cursor = cursor.AddDays(interval);
        }

        if (until.HasValue)
        {
            list.RemoveAll(e => e.Start > until.Value || e.End > until.Value);
        }
        return list.Take(40).ToList();
    }

    private static void AddMonth(ref DateTime cursor, int interval)
    {
        cursor = new DateTime(cursor.Year, cursor.Month, 1, cursor.Hour, cursor.Minute, 0, cursor.Kind).AddMonths(interval)
            .AddDays(Math.Min(cursor.Day - 1, 27));
    }

    private static DateTime StartOfWeek(DateTime d)
    {
        var day = (int)d.DayOfWeek;                 // 0=Sunday
        var diff = day == 0 ? -6 : 1 - day;         // week starts Monday
        return d.Date.AddDays(diff);
    }

    private static CalEvent Clone(CalEvent m, DateTime start, TimeSpan duration, string calName, long n)
    {
        var e = new CalEvent
        {
            Uid = m.Uid + "#" + n,
            Title = m.Title,
            Start = start,
            End = start + duration,
            AllDay = m.AllDay,
            Location = m.Location,
            Calendar = calName,
            Categories = m.Categories,
            Kind = m.Kind,
            Icon = m.Icon,
            Meta = m.Meta,
            Recurring = true,
        };
        e.Id = NewsItem.HashId(e.Uid + start.ToString("o"));
        return e;
    }
}
