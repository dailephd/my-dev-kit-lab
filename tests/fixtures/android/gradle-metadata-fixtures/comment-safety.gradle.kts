plugins {
    id("com.android.application")
}

// applicationId = "com.example.commented-out-should-not-be-used"
/*
namespace = "com.example.also-commented-out"
*/

android {
    namespace = "com.example.commentsafety"
    // A string that merely mentions "applicationId" in prose should not match.
    val note = "the applicationId field below is the real one"

    defaultConfig {
        applicationId = "com.example.commentsafety"
        minSdk = 24
        targetSdk = 34
        compileSdk = 34
    }
}
