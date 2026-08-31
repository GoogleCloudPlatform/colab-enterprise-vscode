# Changelog

All notable changes to the Workbench Notebooks extension are documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-31

### Added

- Automatic access token refresh for Workbench connections, preventing authentication failures during long-running notebook sessions. (#89)

### Changed

- Post-authorization redirect destination updated to the Gemini Enterprise Agent Platform notebooks documentation page. (#69)
- Dependency updates across runtime, build, and test packages. (#63, #64, #65, #68, #74, #75, #76, #84, #85, #86)

### Fixed

- Jupyter kernel picker dismissal on the first Escape key press during Workbench connection setup. (#83)
