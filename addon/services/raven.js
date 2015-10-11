import RavenService from 'ember-cli-sentry/services/raven';

export default RavenService.extend({
    releaseMetaName: 'sentry:revision',
    release: Ember.computed({
        get: function() {
            return $("meta[name='revision']").attr('content');
        }
    })
});

