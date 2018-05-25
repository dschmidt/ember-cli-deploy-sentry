# Ember-cli-deploy-sentry [![Circle CI](https://circleci.com/gh/dschmidt/ember-cli-deploy-sentry/tree/master.svg?style=shield)](https://circleci.com/gh/dschmidt/ember-cli-deploy-sentry/tree/master)

> An ember-cli-deploy-plugin to upload javascript sourcemaps to [Sentry][1].

[![](https://ember-cli-deploy.github.io/ember-cli-deploy-version-badges/plugins/ember-cli-deploy-sentry.svg)](http://ember-cli-deploy.github.io/ember-cli-deploy-version-badges/)

## What is an ember-cli-deploy plugin?

A plugin is an addon that can be executed as a part of the ember-cli-deploy pipeline. A plugin will implement one or more of the ember-cli-deploy's pipeline hooks.

For more information on what plugins are and how they work, please refer to the [Plugin Documentation][10].

## Quick Start
To get up and running quickly, do the following:

- Ensure [ember-cli-deploy-build][11] is installed and configured.

- Install this plugin

```bash
$ ember install ember-cli-deploy-sentry
```

- Place the following configuration into `config/deploy.js`

```javascript
ENV.sentry = {
  // the URL or CDN your js assets are served from
  publicUrl: 'https://your.awesome.site',
  // the sentry install you're using, https://sentry.io for hosted accounts
  sentryUrl: 'https://sentry.your.awesome.site',
  sentryOrganizationSlug: 'AwesomeOrg',
  sentryProjectSlug: 'AwesomeProject',
  // For hosted accounts, generate your bearer/api key here: https://sentry.io/api/
  // One of:
  sentryApiKey: 'awesomeApiKey',
  // or
  sentryBearerApiKey: 'awesomeApiKey'
}
```
- Integrate [raven-js][2] in your page

Install [ember-cli-sentry](https://github.com/damiencaselli/ember-cli-sentry) but import the raven service from `ember-cli-deploy-sentry/services/raven`,
which will automatically handle setting up the release version for you. Sentry needs this to find the correct sourcemap for an error that occurs.

If you don't want to use `ember-cli-sentry` but set [raven-js][2] up manually see [Manual integration with raven-js](#manual-integration-with-raven-js).


- Build sourcemaps in production environment

`ember-cli` builds sourcemaps only in development environment by default. In order to build them always,
just add the following to your `EmberApp` options.
```
sourcemaps: {
  enabled: true,
  extensions: ['js']
}
```

See also: [ember-cli documentation](http://www.ember-cli.com/user-guide/#source-map)


- Run the pipeline

```bash
$ ember deploy
```

## Installation
Run the following command in your terminal:

```bash
ember install ember-cli-deploy-sentry
```

For general information on how to setup [Sentry][1] and [raven-js][2] you probably want to check out the official [Sentry Documentation][3] especially on [Sourcemaps][4].

## ember-cli-deploy Hooks Implemented

For detailed information on what plugin hooks are and how they work, please refer to the [Plugin Documentation][10].

- `configure`
- `upload`
- `didDeploy`

## Configuration Options

For detailed information on how configuration of plugins works, please refer to the [Plugin Documentation][10].

### publicUrl

The public url to the root of where your assets are stored. For instance, if your assets are stored on Cloudfront, it would be `https://xxxx.cloudfront.net`.

*Required*

### sentryUrl

The url of the sentry installation that `ember-cli-deploy-sentry` shall upload sourcemaps and javascript files to.
If you are deploying in your local network, keep in mind you might need to use the local hostname/IP address.

*Required*

### sentryOrganizationSlug

The slug of the organization you want to upload sourcemaps for.
You can specify this in organization settings in sentry.

*Required*

### sentryProjectSlug

The slug of the project you want to upload sourcemaps for.
You can specify this in project settings in sentry.

*Required*

### apiKey _or_ bearerApiKey

Either an HTTP Basic Auth username, or a bearer token. If you are uploading to the current Sentry API, use the latter. Use the former if you are using an older API.

You can create the api key in your organization settings. Make sure it has the `project:write` privilege.

*Required*

### distDir

The root directory that all files matching the `filePattern` will be uploaded from. By default, this option will use the `distDir` property of the deployment context.

*Default:* `context.distDir`

### filePattern

`minimatch` expression that is used to determine which files should be uploaded from the `distDir`.

*Default:* `/**/*.{js,map}`

### revisionKey

The revision string that is used to create releases in sentry.

*Default:*
```javascript
  revisionKey: function(context) {
    return context.revisionData && context.revisionData.revisionKey;
  }
```

### enableRevisionTagging

Enable adding a meta tag with the current revisionKey into the head of your `index.html`.

*Default* true

### replaceFiles

At deploy-time, the plugin will check your Sentry instance for an existing release under the current `revisionKey`. If a release is found and this is set to `true`, all existing files for the matching release will be deleted before the current build's files are uploaded to Sentry. If this is set to `false`, the files on Sentry will remain untouched and the just-built files will not be uploaded. 

*Default* true

## Prerequisites

The following properties are expected to be present on the deployment `context` object:

- `distDir`                     (provided by [ember-cli-deploy-build][11])
- `revisionData.revisionKey`    (provided by [ember-cli-deploy-revision-data][12])


## Manual integration with raven-js

By default a meta tag with the key name `sentry:revision` is inserted in your index.html:
```html
<meta name="sentry:revision" content="(revision)">

```

When you setup [raven-js][2] you can retrieve it like this:

```javascript
Raven.config({
    release: document.querySelector("meta[name='sentry:revision']").content
});
```

If you only want to use the sourcemap upload functionality of `ember-cli-deploy-sentry`, you can disable automatic meta tag insertion completely by setting [enableRevisionTagging](#enableRevisionTagging) to `false`.


Last but not least make sure to setup proper exception catching like [this](https://github.com/getsentry/raven-js/blob/master/plugins/ember.js).

## Running Tests

- `npm test`

## TODO

- use `context.distFiles` from [ember-cli-deploy-build][11] instead globbing distDir again?
- automatically setup raven-js? If you want this, let me know.
- add revision tagging file pattern
- make meta name configurable and document `service.releaseMetaName`

### State

It works. We use it in production at [Hatchet](https://hatchet.is).


[1]: https://getsentry.com "Sentry"
[2]: https://github.com/getsentry/raven-js "raven-js"
[3]: https://docs.getsentry.com/on-premise/clients/javascript/ "Sentry Documentation for Javascript clients"
[4]: https://docs.getsentry.com/on-premise/clients/javascript/sourcemaps/ "Sentry Documentation for Javascript Sourcemaps"

[10]: http://ember-cli.github.io/ember-cli-deploy/plugins "Plugin Documentation"
[11]: https://github.com/zapnito/ember-cli-deploy-build "ember-cli-deploy-build"
[12]: https://github.com/zapnito/ember-cli-deploy-revision-data "ember-cli-deploy-revision-data"
