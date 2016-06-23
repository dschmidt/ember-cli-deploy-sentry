# ember-cli-deploy-sentry Changelog

### 0.4.0

- Gracefully handle reuploading sourcemaps for releases with assigned issues
- Several logging improvements
- Fix releaseMetaName not being respected by raven service
- Several Documentation fixes

### 0.3.1

- Fix possibly broken tarball

### 0.3.0

- Rate limit uploaded sourcemaps
- Update mock-fs dependency to support newer versions of node
- Use prepare hook instead of didBuild hook to catch revision data
- Fix windows issues by using form-data library directly

### 0.2.1

- Fix logging

### 0.2.0

- Add service for usage with ember-cli-sentry

### 0.1.0

- Initial release.
