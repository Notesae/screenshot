# Screenshot project

- Preserve the Windows-first .NET 10 / WPF / WebView2 / React / TypeScript architecture authorized in the original task.
- Read docs/SCOPE.md and docs/BRIDGE.md before changing application behavior.
- Keep native OS access and provider secrets in the host. The editor never receives API keys.
- Do not add paid dependencies, silently download OCR models, send screenshots to a provider without an explicit user action, or claim untested features work.
- Use Chinese user-facing copy and concise comments explaining non-obvious behavior. No Maven checks apply to this project.
- Keep screenshots, credentials, provider configuration, build outputs, and task exports out of Git.
- Each independent worker owns its assigned paths. The integrator controls solution files, root scripts, docs, CI, and commits.
- Verify changes with editor tests/build, .NET tests/build, and real Windows UI where applicable. Record limitations in docs/VALIDATION.md.
