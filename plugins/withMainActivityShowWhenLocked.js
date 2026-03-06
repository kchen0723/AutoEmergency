const { withMainActivity } = require('@expo/config-plugins');

module.exports = function withMainActivityShowWhenLocked(config) {
    return withMainActivity(config, async (config) => {
        let mainActivity = config.modResults.contents;

        const imports = `
import android.view.WindowManager
`;

        const onCreateCode = `
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      )
    }
`;

        // 1. Add imports if they don't exist
        if (!mainActivity.includes('import android.view.WindowManager')) {
            mainActivity = mainActivity.replace(
                'import android.os.Bundle',
                `import android.os.Bundle\n${imports}`
            );
        }

        // 2. Add code to onCreate
        if (!mainActivity.includes('setShowWhenLocked(true)')) {
            mainActivity = mainActivity.replace(
                'super.onCreate(null)',
                `${onCreateCode}\n    super.onCreate(null)`
            );
        }

        config.modResults.contents = mainActivity;
        return config;
    });
};
