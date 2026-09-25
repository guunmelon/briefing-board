namespace BriefingBoard.Core.Text;

public static class StringExtensions
{
    public static string Clip(this string s, int max)
    {
        if (string.IsNullOrEmpty(s) || s.Length <= max) return s;
        return s[..max];
    }

    public static string Ellipsis(this string s, int max)
    {
        if (string.IsNullOrEmpty(s) || s.Length <= max) return s;
        return s[..Math.Max(0, max - 1)] + "…";
    }
}
