# Ember-cli-deploy-sentry

> An ember-cli-deploy-plugin to upload javascript sourcemaps to [Sentry][1].

<hr/>
**WARNING: This plugin is only compatible with ember-cli-deploy versions >= 0.5.0**
<hr/>

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
ENV.sentry {
  publicUrl: 'https://your.awesome.site',
  sentryUrl: 'https://sentry.your.awesome.site',
  sentryOrganizationSlug: 'AwesomeOrg',
  sentryProjectSlug: 'AwesomeProject',
  sentryApiKey: 'awesomeApiKey'
}
```
- Integrate [raven-js][2] in your page

It's important to initialize the client with `release` as the `revisionKey`.
You will probably need to either write the `revisionKey` into your `index.html` file at build time or when serving it.

For example add this to your `index.html` and dynamically replace the `$REVISION` string with `revisionKey`:
```html
<meta name="revision" content="$REVISION">
```

Then when you setup [raven-js][2] you can retrieve it like so:

```javascript
Raven.config({
    release: $("meta[name='revision']").attr('content')
});
```

Last but not least make sure to setup proper exception catching like [this](https://github.com/getsentry/raven-js/blob/master/plugins/ember.js).


We don't use it (yet), but [ember-cli-sentry](https://github.com/damiencaselli/ember-cli-sentry) is probably useful to get started quickly. (It also sets up the exception handlers for you)
Apparently for it to work you will need to set `revisionKey` to your application's `config.APP.version` or set [raven-js][2]'s `release` option later via
`Raven.setReleaseContext($("meta[name='revision']").attr('content'))`.

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

The public url to the root of your website.

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

### sentryApiKey

An api key you can create in your organization settings. Make sure it has the `project:write` privilege.

*Required*

### distDir

The root directory that all files matching the `filePattern` will be uploaded from. By default, this option will use the `distDir` property of the deployment context.

*Default:* `context.distDir`

### didDeployMessage

A message that will be displayed after the distDir has been copied to destDir.

*Default:*

```javascript
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
```

### filePattern

`minimatch` expression that is used to determine which files should be uploaded from the `distDir`.

*Default:* `/**/*.{js,map}`

### revisionKey

The revision string that is used to create releases in sentry.
```javascript
  revisionKey: function(context) {
    return context.revisionData && context.revisionData.revisionKey;
  }
```

## Prerequisites

The following properties are expected to be present on the deployment `context` object:

- `distDir`                     (provided by [ember-cli-deploy-build][11])
- `revisionData.revisionKey`    (provided by [ember-cli-deploy-revision-data][12])

## Running Tests

- `npm test`

## TODO

- Tests ... right?
- use `context.distFiles` from [ember-cli-deploy-build][11] instead globbing distDir again?
- automatically setup raven-js? If you want this, let me know.

### State

It works. We use it in production at [Hatchet](https://hatchet.is).


[1]: https://getsentry.com "Sentry"
[2]: https://github.com/getsentry/raven-js "raven-js"
[3]: https://docs.getsentry.com/on-premise/clients/javascript/ "Sentry Documentation for Javascript clients"
[4]: https://docs.getsentry.com/on-premise/clients/javascript/sourcemaps/ "Sentry Documentation for Javascript Sourcemaps"

[10]: http://ember-cli.github.io/ember-cli-deploy/plugins "Plugin Documentation"
[11]: https://github.com/zapnito/ember-cli-deploy-build "ember-cli-deploy-build"
[12]: https://github.com/zapnito/ember-cli-deploy-revision-data "ember-cli-deploy-revision-data"
