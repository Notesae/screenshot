#if SCREENSHOT_SOURCE_NATIVE
using System.Runtime.CompilerServices;
using OpenCvSharp.Internal;

namespace Screenshot.Ocr;

internal static class SourceNativeRuntime
{
    // Upstream uses LegacyBehavior, so dotnet-hosted tests do not probe this assembly's
    // content directory. Its supported additional path keeps loading lazy and local.
#pragma warning disable CA2255 // Application-owned source profile composition.
    [ModuleInitializer]
    internal static void RegisterPath() => WindowsLibraryLoader.Instance.AdditionalPaths.Add(AppContext.BaseDirectory);
#pragma warning restore CA2255
}
#endif
