import RavenService from 'ember-cli-sentry/services/raven';

export default RavenService.extend({
    releaseMetaName: 'sentry:revision',
    release: Ember.computed({
        get: function() {
            let metaElement = document.getElementsByTagName('meta')[this.get('releaseMetaName')];
            if(metaElement && metaElement.content) {
                return metaElement.content;
            }
        }
    })
});

