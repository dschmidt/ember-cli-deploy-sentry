/* jshint node: true */

'use strict';

const fs = require('fs');
const zlib = require('zlib');
const RSVP = require('rsvp');
const glob = require('glob');
const path = require('path');
const throat = require('throat');
const isGzip = require('is-gzip');
const urljoin = require('url-join');
const request = require('request-promise');
const SilentError = require('silent-error');
const DeployPluginBase = require('ember-cli-deploy-plugin');

module.exports = {
  name: 'ember-cli-deploy-sentry',

  contentFor(type /*, config*/) {
    if (type === 'head-footer') {
      return '<meta name="sentry:revision">';
    }
  },

  createDeployPlugin(options) {
    let DeployPlugin = DeployPluginBase.extend({
      name: options.name,
      runAfter: ['gzip', 's3'],

      requiredConfig: [
        'publicUrl',
        'sentryUrl',
        'sentryOrganizationSlug',
        'sentryProjectSlug',
        'sentryApiKey',
        'revisionKey'
      ],

      defaultConfig: {
        filePattern: '/**/*.{js,map}',
        enableRevisionTagging: true,
        replaceFiles: true,
        distDir(context) {
          return context.distDir;
        },
        revisionKey(context) {
          return context.revisionData && context.revisionData.revisionKey;
        }
      },

      prepare(context) {
        let isEnabled = this.readConfig('enableRevisionTagging');

        if (!isEnabled) {
          return;
        }

        let revisionKey = this.readConfig('revisionKey');
        if (!revisionKey) {
          return new SilentError('Could not find revision key to fingerprint Sentry revision with.');
        }

        // TODO instead of plainly reading index.html, minimatch
        // getConfig('revision patterns') on context.distFiles
        let indexPath = path.join(context.distDir, 'index.html');
        let index = fs.readFileSync(indexPath, 'utf8');
        index = index.replace(
          '<meta name="sentry:revision">',
          '<meta name="sentry:revision" content="' + revisionKey + '">'
        );
        fs.writeFileSync(indexPath, index);
      },

      upload(/* context */) {
        let dir = this.readConfig('distDir');
        let filePattern = this.readConfig('filePattern');
        let pattern = path.join(dir, filePattern);
        let files = glob.sync(pattern);

        let zipped = files
          .map(file => {
            return {
              file,
              buffer: fs.readFileSync(file)
            };
          })
          .filter(({ file, buffer }) => {
            if (isGzip(buffer)) {
              this.log(`un-gzipping ${file}`);
              fs.writeFileSync(file, zlib.gunzipSync(buffer));
              this.log(`✔ un-gzipped ${file}`);

              return true;
            }

            return false;
          });

        this.sentrySettings = {
          url: this.readConfig('sentryUrl'),
          publicUrl: this.readConfig('publicUrl'),
          organizationSlug: this.readConfig('sentryOrganizationSlug'),
          projectSlug: this.readConfig('sentryProjectSlug'),
          apiKey: this.readConfig('sentryApiKey'),
          bearerApiKey: this.readConfig('sentryBearerApiKey'),
          release: this.readConfig('revisionKey')
        };

        this.baseUrl = urljoin(
          this.sentrySettings.url,
          '/api/0/projects/',
          this.sentrySettings.organizationSlug,
          this.sentrySettings.projectSlug,
          '/releases/'
        );

        this.releaseUrl = urljoin(this.baseUrl, this.sentrySettings.release, '/');

        if (!this.sentrySettings.release) {
          throw new SilentError(
            'revisionKey setting is not available, either provide it manually or make sure the ember-cli-deploy-revision-data plugin is loaded'
          );
        }

        let rezip = () => {
          zipped.forEach(({ file, buffer }) => {
            this.log(`restoring original ${file} contents`);
            fs.writeFileSync(file, buffer);
            this.log(`✔ restored ${file}`);
          });
        };

        return this.doesReleaseExist(this.releaseUrl)
          .then(() => this.handleExistingRelease())
          .then(() => rezip())
          .catch(err => this.createRelease(err).then(() => rezip()));
      },

      generateAuth() {
        let apiKey = this.sentrySettings.apiKey;
        let bearerApiKey = this.sentrySettings.bearerApiKey;
        if (bearerApiKey !== undefined) {
          return { bearer: bearerApiKey };
        }
        return { user: apiKey };
      },

      doesReleaseExist(releaseUrl) {
        return request({
          uri: releaseUrl,
          auth: this.generateAuth(),
          json: true
        });
      },

      handleExistingRelease(response) {
        this.log('Release ' + response.version + ' exists.', { verbose: true });
        this.log('Retrieving release files.', { verbose: true });
        return this._getReleaseFiles().then(
          function(response) {
            if (this.readConfig('replaceFiles')) {
              this.log('Replacing files.', { verbose: true });
              return RSVP.all(response.map(this._deleteFile, this))
                .then(this._doUpload.bind(this))
                .then(this._logFiles.bind(this, response));
            } else {
              this.log('Leaving files alone.', { verbose: true });
              return this._logFiles(response);
            }
          }.bind(this)
        );
      },
      createRelease(error) {
        if (error.statusCode === 404) {
          this.log('Release does not exist. Creating.', { verbose: true });
        } else if (error.statusCode === 400) {
          this.log('Bad Request. Not Continuing');
          return RSVP.resolve(error.message);
        }

        return request({
          uri: this.baseUrl,
          method: 'POST',
          auth: this.generateAuth(),
          json: true,
          body: {
            version: this.sentrySettings.release
          },
          resolveWithFullResponse: true
        })
          .then(this._doUpload.bind(this))
          .then(this._logFiles.bind(this))
          .catch(function(err) {
            console.error(err);
            throw new SilentError('Creating release failed');
          });
      },
      _doUpload() {
        return this._getFilesToUpload().then(this._uploadFileList.bind(this));
      },
      _getFilesToUpload() {
        this.log('Generating file list for upload', { verbose: true });
        let dir = this.readConfig('distDir');
        let filePattern = this.readConfig('filePattern');
        let pattern = path.join(dir, filePattern);
        return new RSVP.Promise(function(resolve, reject) {
          // options is optional
          glob(pattern, function(err, files) {
            if (err) {
              reject(err);
            } else {
              resolve(files);
            }
          });
        }).then(function(files) {
          return files.map(function(file) {
            return path.relative(dir, file);
          });
        });
      },
      _uploadFileList(files) {
        this.log('Beginning upload.', { verbose: true });
        return RSVP.all(files.map(throat(5, this._uploadFile.bind(this)))).then(this._getReleaseFiles.bind(this));
      },
      _uploadFile(filePath) {
        let distDir = this.readConfig('distDir');
        let fileName = path.join(distDir, filePath);

        let formData = {
          name: urljoin(this.sentrySettings.publicUrl, filePath),
          file: fs.createReadStream(fileName)
        };

        return request({
          uri: urljoin(this.releaseUrl, 'files/'),
          method: 'POST',
          auth: this.generateAuth(),
          formData: formData
        });
      },
      _getReleaseFiles() {
        return request({
          uri: urljoin(this.releaseUrl, 'files/'),
          auth: this.generateAuth(),
          json: true
        });
      },
      _deleteFile(file) {
        this.log('Deleting ' + file.name, { verbose: true });
        return request({
          uri: urljoin(this.releaseUrl, 'files/', file.id, '/'),
          method: 'DELETE',
          auth: this.generateAuth()
        });
      },
      _logFiles(response) {
        this.log('Files known to sentry for this release', { verbose: true });
        response.forEach(file => this.log('✔  ' + file.name, { verbose: true }));
      },

      didDeploy(/* context */) {
        let deployMessage =
          'Uploaded sourcemaps to sentry release: ' +
          this.readConfig('sentryUrl') +
          '/' +
          this.readConfig('sentryOrganizationSlug') +
          '/' +
          this.readConfig('sentryProjectSlug') +
          '/releases/' +
          this.readConfig('revisionKey') +
          '/';

        this.log(deployMessage);
      }
    });
    return new DeployPlugin();
  }
};
