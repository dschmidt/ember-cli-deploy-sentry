/* jshint node: true */
'use strict';

var Promise   = require('ember-cli/lib/ext/promise');
var DeployPluginBase = require('ember-cli-deploy-plugin');
var SilentError         = require('silent-error');
var glob = require("glob");
var urljoin = require("url-join");
var request = require('request-promise');
var path = require('path');
var fs = require('fs');
var throat = require('throat');


module.exports = {
  name: 'ember-cli-deploy-sentry',

  contentFor: function(type/*, config*/) {
    if (type === 'head-footer') {
      return '<meta name="sentry:revision"></meta>';
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
        enableRevisionTagging: true,

        didDeployMessage: function(/*context*/){
          return "Uploaded sourcemaps to sentry release: "
            + this.readConfig('sentryUrl')
            + '/'
            + this.readConfig('sentryOrganizationSlug')
            + '/'
            + this.readConfig('sentryProjectSlug')
            + '/releases/'
            + this.readConfig('revisionKey')
            + '/';
        },
        replaceFiles: true
      },
      requiredConfig: ['publicUrl', 'sentryUrl', 'sentryOrganizationSlug', 'sentryProjectSlug', 'sentryApiKey', 'revisionKey'],

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

      upload: function(/* context */) {
        this.sentrySettings = {
          url: this.readConfig('sentryUrl'),
          publicUrl: this.readConfig('publicUrl'),
          organizationSlug: this.readConfig('sentryOrganizationSlug'),
          projectSlug: this.readConfig('sentryProjectSlug'),
          apiKey: this.readConfig('sentryApiKey'),
          bearerApiKey: this.readConfig('sentryBearerApiKey'),
          release: this.readConfig('revisionKey')
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
        });
      },
      handleExistingRelease: function handleExistingRelease(response) {
        this.log('Release ' + response.version + ' exists.', {verbose: true});
        this.log('Retrieving release files.', {verbose: true});
        return this._getReleaseFiles().then(function(response) {
          if (this.readConfig('replaceFiles')) {
            this.log('Replacing files.', {verbose: true});
            return Promise.all(response.map(this._deleteFile, this))
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
          return Promise.resolve(error.message);
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
        return new Promise(function(resolve, reject) {
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
        return Promise.all(files.map(throat(5, this._uploadFile.bind(this))))
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
          formData: formData
        });
      },
      _getReleaseFiles: function getReleaseFiles() {
        return request({
          uri: urljoin(this.releaseUrl, 'files/'),
          auth: this.generateAuth(),
          json: true
        });
      },
      _deleteFile: function deleteFile(file) {
        this.log('Deleting ' + file.name, {verbose: true});
        return request({
          uri: urljoin(this.releaseUrl, 'files/', file.id, '/'),
          method: 'DELETE',
          auth: this.generateAuth(),
        });
      },
      _logFiles: function logFiles(response) {
        this.log('Files known to sentry for this release', { verbose: true });
        response.forEach(function(file) { this.log('✔  ' + file.name, { verbose: true }); }, this);
      },

      didDeploy: function(/* context */){
        var didDeployMessage = this.readConfig('didDeployMessage');
        if (didDeployMessage) {
          this.log(didDeployMessage);
        }
      }
    });
    return new DeployPlugin();
  }
};
