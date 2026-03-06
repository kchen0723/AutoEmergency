package expo.modules.mymodule

import android.content.Intent
import android.provider.MediaStore
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MyModule")

    Function("unlock") {
      val activity = appContext.currentActivity
      activity?.runOnUiThread {
        try {
          // Launch the secure camera directly over the lock screen.
          // This is the ONLY official way to take photos without entering the PIN/Password
          // on modern Samsung/Android devices.
          val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE_SECURE)
          activity.startActivity(intent)
        } catch (e: Exception) {
          e.printStackTrace()
        }
      }
    }
  }
}
