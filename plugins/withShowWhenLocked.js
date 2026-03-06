const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withShowWhenLocked(config) {
    return withAndroidManifest(config, async (config) => {
        const androidManifest = config.modResults;
        const application = androidManifest.manifest.application[0];
        const mainActivity = application.activity.find(
            (a) => a.$['android:name'] === '.MainActivity'
        );

        if (mainActivity) {
            // Add attributes to allow the app to show over the lock screen
            mainActivity.$['android:showWhenLocked'] = 'true';
            mainActivity.$['android:turnScreenOn'] = 'true';

            // Add intent filters to make this app register as a secure camera
            if (!mainActivity['intent-filter']) {
                mainActivity['intent-filter'] = [];
            }

            mainActivity['intent-filter'].push({
                action: [
                    { $: { 'android:name': 'android.media.action.STILL_IMAGE_CAMERA_SECURE' } },
                    { $: { 'android:name': 'android.media.action.IMAGE_CAPTURE_SECURE' } }
                ],
                category: [
                    { $: { 'android:name': 'android.intent.category.DEFAULT' } }
                ]
            });
        }

        return config;
    });
};
