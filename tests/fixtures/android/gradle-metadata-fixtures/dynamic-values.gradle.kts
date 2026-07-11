plugins {
    id("com.android.application")
}

val gitVersionName = providers.exec { commandLine("git", "describe") }.standardOutput.asText.get()

android {
    namespace = "com.example.dynamic"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        applicationId = appIdFromProperties()
        versionName = gitVersionName
        targetSdk = project.property("targetSdkFromProperties") as Int
        minSdk = 24
    }
}
