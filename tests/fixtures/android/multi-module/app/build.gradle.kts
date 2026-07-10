plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.example.multimodule.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.multimodule.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }
}

dependencies {
    implementation(project(":core"))
    implementation(project(":feature-login"))
}
