using System.IO;
namespace BriefingBoard.Host;

/// <summary>저장 경로 모음 — %LOCALAPPDATA%\BriefingBoard</summary>
public static class AppPaths
{
    public static string RootDir
    {
        get
        {
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var dir = Path.Combine(local, "BriefingBoard");
            Directory.CreateDirectory(dir);
            return dir;
        }
    }

    public static string WebView2DataDir => Path.Combine(RootDir, "WebView2");
    public static string HostJson => Path.Combine(RootDir, "host.json");
    public static string NewsCacheJson => Path.Combine(RootDir, "news-cache.json");
    public static string EventsCacheJson => Path.Combine(RootDir, "icloud-cache.json");

    public static string? WebIndexPath
    {
        get
        {
            var local = Path.Combine(AppContext.BaseDirectory, "web", "index.html");
            return File.Exists(local) ? local : null;
        }
    }
}
