/* jshint node: true */
'use strict';

var RSVP = require('rsvp');
var DeployPluginBase = require('ember-cli-deploy-plugin');
var SilentError         = require('silent-error');
var glob = require("glob");
var urljoin_ = require("url-join");
var request = require('request-promise');
var path = require('path');
var fs = require('fs');
var throat = require('throat');
var parse = require('parse-link-header');

var urljoin = function(...args) {
  return urljoin_(...args).split('\\').join('/');
}

module.exports = {
  name: 'ember-cli-deploy-sentry',

  contentFor: function(type/*, config*/) {
    if (type === 'head-footer') {
      return '<meta name="sentry:revision">';
    }
  },

  createDeployPlugin: function(options) {
    var DeployPlugin = DeployPluginBase.extend({
      name: options.name,
      defaultConfig: {
        distDir: function(context) {
          return context.distDir;
        },
        filePattern: '/**/*.{js,map}',
        revisionKey: function(context) {
          return context.revisionData && context.revisionData.revisionKey;
        },
        revisionCommits: undefined,
        enableRevisionTagging: true,
        replaceFiles: true,
        strictSSL: true,
      },
      requiredConfig: ['publicUrl', 'sentryUrl', 'sentryOrganizationSlug', 'sentryProjectSlug', 'revisionKey'],

      prepare: function(context) {
        var isEnabled = this.readConfig('enableRevisionTagging');
        if(!isEnabled) {
          return;
        }

        var revisionKey = this.readConfig('revisionKey');
        if(!revisionKey) {
          return new SilentError("Could not find revision key to fingerprint Sentry revision with.");
        }

        // TODO instead of plainly reading index.html, minimatch
        // getConfig('revision patterns') on context.distFiles
        var indexPath = path.join(context.distDir, "index.html");
        var index = fs.readFileSync(indexPath, 'utf8');
        index = index.replace('<meta name="sentry:revision">',
                                  '<meta name="sentry:revision" content="'+revisionKey+'">');
        fs.writeFileSync(indexPath, index);
      },

      /**
       * Upload the sourcemaps to Sentry
       *
       * We intentionally use the semantically not quite correct `didPrepare` hook instead of `upload` to work around
       * an issue with ember-cli-deploy-gzip (and other compression plugins like -brotli or -compress), where gzipped
       * sourcemaps are uploaded that Sentry is not able to decompress automatically. By using a hook before `willUpload`
       * we will upload the still uncompressed files.
       *
       * See https://github.com/dschmidt/ember-cli-deploy-sentry/issues/26 and https://github.com/getsentry/sentry/issues/4566
       */
      didPrepare: function(/* context */) {
        this.sentrySettings = {
          url: this.readConfig('sentryUrl'),
          publicUrl: this.readConfig('publicUrl'),
          organizationSlug: this.readConfig('sentryOrganizationSlug'),
          projectSlug: this.readConfig('sentryProjectSlug'),
          apiKey: this.readConfig('sentryApiKey'),
          bearerApiKey: this.readConfig('sentryBearerApiKey'),
          release: this.readConfig('revisionKey'),
          commits: this.readConfig('revisionCommits'),
        };
        this.baseUrl = urljoin(this.sentrySettings.url, '/api/0/projects/', this.sentrySettings.organizationSlug, this.sentrySettings.projectSlug, '/releases/');
        this.releaseUrl = urljoin(this.baseUrl, this.sentrySettings.release, '/');

        if(!this.sentrySettings.release) {
          throw new SilentError('revisionKey setting is not available, either provide it manually or make sure the ember-cli-deploy-revision-data plugin is loaded');
        }

        return this.doesReleaseExist(this.releaseUrl)
          .then(this.handleExistingRelease.bind(this))
          .catch(this.createRelease.bind(this));
      },

      generateAuth: function() {
        var apiKey = this.sentrySettings.apiKey;
        var bearerApiKey = this.sentrySettings.bearerApiKey;
        if (bearerApiKey !== undefined) {
          return { bearer: bearerApiKey };
        }
        return { user: apiKey };
      },

      doesReleaseExist: function(releaseUrl) {
        return request({
          uri: releaseUrl,
          auth: this.generateAuth(),
          json: true,
          strictSSL: this.readConfig('strictSSL'),
        });
      },
      handleExistingRelease: function handleExistingRelease(response) {
        this.log('Release ' + response.version + ' exists.', {verbose: true});
        this.log('Retrieving release files.', {verbose: true});
        return this._getReleaseFiles().then(function(response) {
          if (this.readConfig('replaceFiles')) {
            this.log('Replacing files.', {verbose: true});
            return RSVP.all(response.map(this._deleteFile, this))
              .then(this._doUpload.bind(this))
              .then(this._logFiles.bind(this, response));
          } else {
            this.log('Leaving files alone.', {verbose: true});
            return this._logFiles(response);
          }
        }.bind(this));
      },
      createRelease: function createRelease(error) {
        if (error.statusCode === 404) {
          this.log('Release does not exist. Creating.', {verbose: true});
        } else if (error.statusCode === 400) {
          this.log('Bad Request. Not Continuing');
          return RSVP.resolve(error.message);
        }

        var body = {
          version: this.sentrySettings.release
        };
        if (this.sentrySettings.commits) {
          body.commits = this.sentrySettings.commits;
        }

        return request({
          uri: this.baseUrl,
          method: 'POST',
          auth: this.generateAuth(),
          json: true,
          body: body,
          resolveWithFullResponse: true,
          strictSSL: this.readConfig('strictSSL'),
        })
        .then(this._doUpload.bind(this))
        .then(this._logFiles.bind(this))
        .catch(function(err){
          console.error(err);
          throw new SilentError('Creating release failed');
        });
      },
      _doUpload: function doUpload() {
        return this._getFilesToUpload()
          .then(this._uploadFileList.bind(this));
      },
      _getFilesToUpload: function getFilesToUpload() {
        this.log('Generating file list for upload', {verbose: true});
        var dir = this.readConfig('distDir');
        var filePattern = this.readConfig('filePattern');
        var pattern = path.join(dir, filePattern);
        return new RSVP.Promise(function(resolve, reject) {
          // options is optional
          glob(pattern, function (err, files) {
            if(err) {
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
      _uploadFileList: function uploadFileList(files) {
        this.log('Beginning upload.', {verbose: true});
        return RSVP.all(files.map(throat(5, this._uploadFile.bind(this))))
          .then(this._getReleaseFiles.bind(this));
      },
      _uploadFile: function uploadFile(filePath) {
        var distDir = this.readConfig('distDir');
        var fileName = path.join(distDir, filePath);

        var formData = {
          name: urljoin(this.sentrySettings.publicUrl, filePath),
          file: fs.createReadStream(fileName),
        };

        return request({
          uri: urljoin(this.releaseUrl, 'files/'),
          method: 'POST',
          auth: this.generateAuth(),
          formData: formData,
          strictSSL: this.readConfig('strictSSL'),
        });
      },
      _getReleaseFiles: function getReleaseFiles(options = {}) {
        return request({
          uri: options.url || urljoin(this.releaseUrl, 'files/'),
          auth: this.generateAuth(),
          json: true,
          resolveWithFullResponse: true,
          strictSSL: this.readConfig('strictSSL'),
        }).then((response) => {
          var links = parse(response.headers.link);

          if (!links.next || links.next.results === 'false') {
            return response.body;
          }

          return this._getReleaseFiles({url: links.next.url}).then((results) => {
            return results.concat(response.body);
          });
        });
      },
      _deleteFile: function deleteFile(file) {
        this.log('Deleting ' + file.name, {verbose: true});
        return request({
          uri: urljoin(this.releaseUrl, 'files/', file.id, '/'),
          method: 'DELETE',
          auth: this.generateAuth(),
          strictSSL: this.readConfig('strictSSL'),
        });
      },
      _logFiles: function logFiles(response) {
        this.log('Files known to sentry for this release', { verbose: true });
        response.forEach(function(file) { this.log('✔  ' + file.name, { verbose: true }); }, this);
      },

      didDeploy: function(/* context */){
        var deployMessage = "Uploaded sourcemaps to sentry release: "
          + this.readConfig('sentryUrl')
          + '/'
          + this.readConfig('sentryOrganizationSlug')
          + '/'
          + this.readConfig('sentryProjectSlug')
          + '/releases/'
          + this.readConfig('revisionKey')
          + '/';

        if (this.readConfig('revisionCommits')) {
          deployMessage += '\n\t' + 'Commits ' + this.readConfig('revisionCommits').map(commit => commit.id).join(', ') + ' associated with this release';
        }

        this.log(deployMessage);
      }
    });
    return new DeployPlugin();
  }
};
