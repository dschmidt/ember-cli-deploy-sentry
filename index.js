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
var FormData = require('form-data');
var zlib = require('zlib');

module.exports = {
  name: 'ember-cli-deploy-sentry',

  contentFor: function(type, config) {
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
        gunzip: false,
        revisionKey: function(context) {
          return context.revisionData && context.revisionData.revisionKey;
        },
        enableRevisionTagging: true,

        didDeployMessage: function(context){
          return "Uploaded sourcemaps to sentry release: "
            + this.readConfig('sentryUrl')
            + '/'
            + this.readConfig('sentryOrganizationSlug')
            + '/'
            + this.readConfig('sentryProjectSlug')
            + '/releases/'
            + this.readConfig('revisionKey')
            + '/';
        }
      },
      requiredConfig: ['publicUrl', 'sentryUrl', 'sentryOrganizationSlug', 'sentryProjectSlug', 'sentryApiKey', 'revisionKey', 'gunzip'],

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
        var index = index.replace('<meta name="sentry:revision">',
            '<meta name="sentry:revision" content="'+revisionKey+'">');
        fs.writeFileSync(indexPath, index);
      },

      _createRelease: function createRelease(sentrySettings) {
        var url = urljoin(sentrySettings.url, '/api/0/projects/', sentrySettings.organizationSlug,  sentrySettings.projectSlug, '/releases/');

        return request({
          uri: url,
          method: 'POST',
          auth: {
            user: sentrySettings.apiKey
          },
          json: true,
          body: {
            version: sentrySettings.release
          },
          resolveWithFullResponse: true
        });
      },
      _deleteRelease: function createRelease(sentrySettings) {
        var url = urljoin(sentrySettings.url, '/api/0/projects/', sentrySettings.organizationSlug,  sentrySettings.projectSlug, '/releases/', sentrySettings.release) + '/';

        return request({
          uri: url,
          method: 'DELETE',
          auth: {
            user: sentrySettings.apiKey
          },
          json: true,
          body: {
            version: sentrySettings.release
          },
          resolveWithFullResponse: true
        });
      },

      _getUploadFiles: function getUploadFiles(dir, filePattern) {
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

      _uploadFile: function uploadFile(sentrySettings, distDir, filePath, gunzip) {
        var host = sentrySettings.url;
        var urlPath = urljoin('/api/0/projects/', sentrySettings.organizationSlug,  sentrySettings.projectSlug, '/releases/', sentrySettings.release, '/files/');

        var formData = new FormData();
        formData.append('name', urljoin(sentrySettings.publicUrl, filePath));

        return new Promise(function(resolve, reject) {
          var addFilePromise = new Promise(function(resolve, reject){
            var fileName = path.join(distDir, filePath);
            if(gunzip){
              var gunzipInp = zlib.createGunzip();
              var gunzippedoutFilename = fileName + '.unzipped';
              var inp = fs.createReadStream(fileName);
              var gunzippedout = fs.createWriteStream(gunzippedoutFilename);

              inp.pipe(gunzipInp).pipe(gunzippedout);

              inp.on('error', function(err){
                reject(err);
              });

              gunzippedout.on('error', function(err){
                reject(err);
              });

              gunzippedout.on('finish', function(){
                var gunzippedFileSize = fs.statSync(gunzippedoutFilename)["size"];

                formData.append('file', fs.createReadStream(gunzippedoutFilename), {
                  knownLength: gunzippedFileSize
                });

                resolve(gunzippedoutFilename);
              });

            }else{
              var fileSize = fs.statSync(fileName)["size"];

              formData.append('file', fs.createReadStream(fileName), {
                knownLength: fileSize
              });

              resolve();
            }
          });

          addFilePromise.then(function(gunzippedoutFilename){
            formData.submit({
              protocol: 'https:',
              host: 'app.getsentry.com',
              path: urlPath,
              auth: sentrySettings.apiKey + ':'
            }, function(error, result) {
              if(error) {
                reject(error);
              }
              result.resume();

              if(gunzip && gunzippedoutFilename){
                fs.unlink(gunzippedoutFilename);
              }

              result.on('end', function() {
                resolve();
              });
            });
          }, function(){
            reject();
          });
        });
      },

      _getReleaseFiles: function getReleaseFiles(sentrySettings) {
        var url = urljoin(sentrySettings.url, '/api/0/projects/', sentrySettings.organizationSlug,  sentrySettings.projectSlug, '/releases/', sentrySettings.release, '/files') + '/';
        return request({
          uri: url,
          auth: {
              user: sentrySettings.apiKey
          },
          json: true,
          body: {
              version: sentrySettings.release
          }
        });
      },

      upload: function(/* context */) {
        var plugin = this;
        var distDir = this.readConfig('distDir');
        var sentrySettings = {
            url: plugin.readConfig('sentryUrl'),
            publicUrl: plugin.readConfig('publicUrl'),
            organizationSlug: plugin.readConfig('sentryOrganizationSlug'),
            projectSlug: plugin.readConfig('sentryProjectSlug'),
            apiKey: plugin.readConfig('sentryApiKey'),
            release: plugin.readConfig('revisionKey')
        };
        var filePattern = this.readConfig('filePattern');
        var gunzip = plugin.readConfig('gunzip');

        if(!sentrySettings.release) {
          throw new SilentError('revisionKey setting is not available, either provide it manually or make sure the ember-cli-deploy-revision-data plugin is loaded');
        }
        return this._deleteRelease(sentrySettings).then(function() {}, function() {}).then(function() {
          return plugin._createRelease(sentrySettings).then(function(response) {
            return plugin._getUploadFiles(distDir, filePattern).then(function(files) {
              var uploads = [];
              for(var i=0;i<files.length;i++) {
                uploads.push(plugin._uploadFile(sentrySettings, distDir, files[i], gunzip));
              }
              return Promise.all(uploads).then(function() {
                return plugin._getReleaseFiles(sentrySettings);
              }).then(function(response) {
                plugin.log('Files known to sentry for this release', { verbose: true });
                plugin.log(response.map(function(file){return file.name;}), { verbose: true });
              });
            });
          }, function(err){
            console.error(err);
            throw new SilentError('Creating release failed');
          });
        });
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
