# Contributing to ECpdfSign

Thanks for your interest in ECpdfSign! Bug reports, ideas and pull requests are welcome.

## Reporting bugs and ideas

Open an [issue](https://github.com/Matthis/ECpdfSign/issues). For bugs, please include:

- your operating system (Windows 11 or macOS, with version),
- the ECpdfSign version,
- what you did, what you expected, and what happened instead.

Please do **not** attach confidential PDFs. If a bug only happens with a specific file, try to
reproduce it with a harmless sample document.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change. Keep pull requests small and focused on one topic.
3. Run the tests:
   ```bash
   npm test                      # frontend and PDF output (Vitest)
   cd src-tauri && cargo test    # backend
   ```
4. Open the pull request and describe what it changes and why.

### Contributor License Agreement (CLA)

Before your first pull request can be merged, you need to accept the
[Contributor License Agreement](CLA.md). You keep the copyright in your contribution, but you allow
the maintainer to also offer it under licenses other than the GPL, including commercial ones.

Signing takes one comment: the CLA Assistant bot will ask you in the pull request, and you reply
with

> I have read the CLA Document and I hereby sign the CLA

You only need to do this once.

## License

ECpdfSign is licensed under the [GNU General Public License v3.0](LICENSE).
By contributing, you agree that your contributions are distributed under this license and that
the terms of the [CLA](CLA.md) apply to them.
