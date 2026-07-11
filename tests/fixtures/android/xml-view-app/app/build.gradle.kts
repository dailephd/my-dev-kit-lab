plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.example.xmlviewapp"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.xmlviewapp"
        minSdk = 21
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }
}
