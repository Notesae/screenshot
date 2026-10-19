# Minimal OCR native runtime

The source profile builds OpenCV 4.13.0 (core/imgproc/imgcodecs only), OpenCvSharp 4.13.0.20260627, libpng 1.6.55 and zlib 1.3.1 from the commits and archive SHA256 values in `sources.lock.json`. Upstream sources stay unmodified. Bundled OpenCV code retains additional source notices, including SoftFloat/fdlibm and legacy BSD notices; four source archives do not imply four total license obligations.

## Build and verify

Existing MSVC x64 / Windows SDK are required. Use existing CMake >=3.24 and Ninja, or explicitly run `./scripts/prepare-native-tools.ps1` for fixed portable CMake 3.31.11 / Ninja 1.13.2 under artifacts/tools. This does not install tools, accept an agreement, modify system settings or persist PATH. CI runs the explicit preparation step. Source downloads are fixed and checksum-verified.

```powershell
./scripts/build-native.ps1
node scripts/verify-native-runtime.cjs
./scripts/prepare-ocr-models.ps1
./scripts/verify.ps1 -WithOcrIntegration
./scripts/native-quality.ps1
./scripts/publish.ps1 -Output artifacts/Screenshot-0.4.2-win-x64
```

`build-native.ps1` validates extracted source files against their archives on reuse, stages static dependencies under artifacts/native-build, and writes artifacts/native-runtime/win-x64. It does not install prerequisites. IPP/IW, ITT/tracing, OpenCL, contrib, DNN, camera/video/UI and optional image codecs are disabled. External PNG/zlib paths are explicit. The wrapper uses the unmodified upstream translation units and feature guards, with MSVC static CRT and normal Windows protection flags.

The resulting native-build.json identifies the DLL, archive commits/hashes, actual source LICENSE/COPYRIGHT and source-comment notices, all evidence hashes, CMake caches, toolchain and link-map library/object records. Windows SDK/MSVC platform libraries are separate from the open-source inputs. Toolchain differences may change the DLL hash; bit-identical reproducibility is not promised.

The source profile registers the pinned output directory with the upstream loader, without loading the DLL until an OpenCV operation occurs. Tests verify the hash of the DLL actually loaded through production PNG decoding. No system DLL search path is changed. No automatic vendor fallback is provided.

## Explicit fallback and comparison

Keep the 0.4.1 portable package untouched. To build its official vendor native profile explicitly, use `./scripts/verify.ps1 -NativeRuntime Vendor`, or `./scripts/publish.ps1 -NativeRuntime Vendor -Output artifacts/Screenshot-vendor-fallback`. Source and Vendor build paths are isolated; never publish either profile over an existing package. Vendor native provenance remains in licenses/vendor-native-components-0.4.1.json, and its older license gaps still apply.

`native-quality.ps1` builds a separate Vendor-profile comparison driver, verifies the original official NuGet baseline archive/DLL, and runs three rounds in alternating order with explicit per-process native handles. Only that test driver overrides P/Invoke. Fixed CPU models recognize memory-generated Chinese/English images, then compare text, block IDs, polygons, confidence, decoded PNG pixels and detector samples. Five timed observations follow warmup in each process. The comparator flags >15% median regression for investigation. Sampled memory and local timing are observations, not real-world accuracy or latency guarantees.

No product window, desktop capture, hotkey, clipboard, monitor/window enumeration or service API is used. New releases, signing, installers and distributor/end-user license decisions remain separate approvals.
