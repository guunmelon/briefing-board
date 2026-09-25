using System.IO;

namespace BriefingBoard.Host;

/// <summary>경량 파일 로그 — %LOCALAPPDATA%\BriefingBoard\app.log (진단용). 실패 시 조용히 무시.</summary>
public static class AppLog
{
    private static readonly object Gate = new();
    private static readonly string FilePath = Path.Combine(AppPaths.RootDir, "app.log");
    private const long Cap = 512 * 1024;      // 512KB 초과 시 절반으로 정리

    public static void Write(string line)
    {
        try
        {
            lock (Gate)
            {
                if (File.Exists(FilePath) && new FileInfo(FilePath).Length > Cap)
                {
                    var all = File.ReadAllText(FilePath);
                    File.WriteAllText(FilePath, all.Length > Cap / 2
                        ? all.Substring((int)(all.Length - Cap / 2)) : all);
                }
                File.AppendAllText(FilePath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}  {line}{Environment.NewLine}");
            }
        }
        catch { /* 로그 실패는 앱에 영향 없음 */ }
    }
}
