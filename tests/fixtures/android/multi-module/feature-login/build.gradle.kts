plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.example.multimodule.featurelogin"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
        targetSdk = 34
    }
}

dependencies {
    implementation(project(":core"))
}
