/*jshint globalstrict: true*/
'use strict';

var RSVP = require('ember-cli/lib/ext/promise');

var assert  = require('ember-cli/tests/helpers/assert');

var mockFs = require('mock-fs');
var fs = require('fs');

describe('deploySentry plugin', function() {
  var subject, mockUi, context;

  before(function() {
    subject = require('../../index');
  });

  beforeEach(function() {
    mockUi = {
      messages: [],
      write: function() { },
      writeLine: function(message) {
        this.messages.push(message);
      }
    };

    context = {
      distFiles: ['app.css', 'app.js'],
      ui: mockUi,
      config: {
        deploySentry: {
          publicUrl: 'http://example.org',
          sentryUrl: 'http://example.org',
          sentryOrganizationSlug: 'slug',
          sentryProjectSlug: 'slug',
          sentryApiKey: 'api-key',
          revisionKey: 'abcdef'
        }
      }
    };
  });

  it('has a name', function() {
    var plugin = subject.createDeployPlugin({
      name: 'test-plugin'
    });

    assert.equal(plugin.name, 'test-plugin');
  });

  it('implements the correct deployment hooks', function() {
    var plugin = subject.createDeployPlugin({
      name: 'test-plugin'
    });

    assert.equal(typeof plugin.configure, 'function');
    assert.equal(typeof plugin.willUpload, 'function');
    assert.equal(typeof plugin.upload, 'function');
    assert.equal(typeof plugin.didDeploy, 'function');
  });

  describe('configure hook', function() {
    it('does not throw if config is ok', function() {
      var plugin = subject.createDeployPlugin({
        name: 'deploySentry'
      });
      plugin.beforeHook(context);
      plugin.configure(context);
      assert.ok(true); // it didn't throw
    });

    it('throws if config is not valid', function() {
      var plugin = subject.createDeployPlugin({
        name: 'deploySentry'
      });

      context.config = { deploySentry: {} };

      plugin.beforeHook(context);
      assert.throws(function(){
        plugin.configure(context);
      });
    });

    describe('without providing config', function () {
      var plugin;

      beforeEach(function() {
        plugin = subject.createDeployPlugin({
          name: 'deploySentry'
        });
      });

      it('warns about missing required config', function() {
        context.config = { deploySentry: {} };

        plugin.beforeHook(context);
        assert.throws(function(error){
          plugin.configure(context);
        });
        var messages = mockUi.messages.reduce(function(previous, current) {
          if (/- Missing required config:\s.*/.test(current)) {
            previous.push(current);
          }

          return previous;
        }, []);

        assert.equal(messages.length, 1); // doesn't log all failures, just first one
      });

      it('warns about missing optional config', function() {
        plugin.beforeHook(context);
        plugin.configure(context);
        var messages = mockUi.messages.reduce(function(previous, current) {
          if (/- Missing config:\s.*, using default:\s/.test(current)) {
            previous.push(current);
          }

          return previous;
        }, []);

        assert.equal(messages.length, 4);
      });

      it('adds default config to the config object', function() {
        plugin.beforeHook(context);
        plugin.configure(context);
        assert.isDefined(context.config.deploySentry.distDir);
        assert.isDefined(context.config.deploySentry.filePattern);
        assert.isDefined(context.config.deploySentry.enableRevisionTagging);
        assert.isDefined(context.config.deploySentry.didDeployMessage);
      });
    });

    describe('with optional config supplied', function () {
      var plugin;

      beforeEach(function() {
        plugin = subject.createDeployPlugin({
          name: 'deploySentry'
        });
        context.config.deploySentry["distDir"] = "dist/dir";
        context.config.deploySentry["filePattern"] = "/**/*.{js,map}";
        context.config.deploySentry["enableRevisionTagging"] = false;
        context.config.deploySentry["didDeployMessage"] = "ok";
      });

      it('does not warn about missing optional config', function() {
        plugin.beforeHook(context);
        plugin.configure(context);
        var messages = mockUi.messages.reduce(function(previous, current) {
          if (/- Missing config:\s.*, using default:\s/.test(current)) {
            previous.push(current);
          }

          return previous;
        }, []);
        assert.equal(messages.length, 0);
      });
    });
  });

  describe('contentFor hook', function() {
    it('is defined', function() {
      assert.equal(typeof subject.contentFor, 'function');
    });
    it('returns content for head-footer', function() {
      assert.equal(subject.contentFor('head-footer'), '<meta name="sentry:revision"></meta>');
    });
    it('does not return content for other types', function() {
      assert.notEqual(subject.contentFor('head-barter'), '<meta name="sentry:revision"></meta>');
    })
  });

  describe('willUpload hook', function() {
    var plugin, fileSystem, indexFile;
    beforeEach(function() {
      plugin = subject.createDeployPlugin({
        name: 'deploySentry'
      });
      indexFile = mockFs.file({
        content: '<html><head><meta name="sentry:revision"></meta></head><body></body></html>'
      });
      fileSystem = {
        '/path/to/fake/dir': {
          'index.html': indexFile
        }
      };
      mockFs(fileSystem);
      context.distDir = '/path/to/fake/dir';
      context.revisionKey = 'abc123';
    });
    afterEach(function() {
      mockFs.restore();
    });

    it('does not fill in revision data when disabled', function() {
      context.config.deploySentry.enableRevisionTagging = false;

      plugin.beforeHook(context);
      plugin.configure(context);
      plugin.willUpload(context);
      var result = fs.readFileSync('/path/to/fake/dir/index.html', 'utf8');
      assert.notEqual(result.indexOf('<meta name="sentry:revision">'), -1);
    });

    it('fills in revision data in the meta-tag', function() {
      plugin.beforeHook(context);
      plugin.configure(context);
      plugin.willUpload(context);
      var result = fs.readFileSync('/path/to/fake/dir/index.html', 'utf8');
      assert.notEqual(result.indexOf('<meta name="sentry:revision" content="'+context.config.deploySentry.revisionKey+'">'), -1);
    });
  });

  describe('upload hook', function() {
    // possibly mock Sentry out here
  });
});
