using System;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Screenshot.App.Updates;

// 严格 SemVer；预发布编号按数值比较，构建元数据不参与升级顺序。
internal sealed record ReleaseVersion(int Major, int Minor, int Patch, string Pre = "") : IComparable<ReleaseVersion>
{
    internal static ReleaseVersion Parse(string text)
    {
        if (text.Length > 128) throw new FormatException("版本号过长。");
        var m = Regex.Match(text, @"^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$", RegexOptions.CultureInvariant);
        if (!m.Success || text.Length > 128) throw new FormatException("版本号无效。");
        var pre = m.Groups[4].Value;
        foreach (var part in pre.Split('.'))
            if (Regex.IsMatch(part, @"^\d+$") && part.Length > 1 && part[0] == '0') throw new FormatException("预发布版本号无效。");
        return new(int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture), int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture), int.Parse(m.Groups[3].Value, CultureInfo.InvariantCulture), pre);
    }
    public int CompareTo(ReleaseVersion? other)
    {
        if (other is null) return 1;
        var c = Major.CompareTo(other.Major); if (c != 0) return c;
        c = Minor.CompareTo(other.Minor); if (c != 0) return c;
        c = Patch.CompareTo(other.Patch); if (c != 0) return c;
        if (Pre == other.Pre) return 0;
        if (Pre == "") return 1; if (other.Pre == "") return -1;
        var a = Pre.Split('.'); var b = other.Pre.Split('.');
        for (var i = 0; i < Math.Min(a.Length, b.Length); i++)
        {
            var an = Regex.IsMatch(a[i], @"^\d+$"); var bn = Regex.IsMatch(b[i], @"^\d+$");
            c = an && bn ? (a[i].Length == b[i].Length ? string.CompareOrdinal(a[i], b[i]) : a[i].Length.CompareTo(b[i].Length))
                : an != bn ? (an ? -1 : 1) : string.CompareOrdinal(a[i], b[i]);
            if (c != 0) return c;
        }
        return a.Length.CompareTo(b.Length);
    }
    public override string ToString() => $"{Major}.{Minor}.{Patch}" + (Pre == "" ? "" : "-" + Pre);
}
