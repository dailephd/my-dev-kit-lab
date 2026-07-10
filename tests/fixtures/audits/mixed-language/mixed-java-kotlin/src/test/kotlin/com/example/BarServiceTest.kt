package com.example

class BarServiceTest {
    fun testGreet() {
        val service = BarService()
        assert(service.greet("world") == "Hello, world")
    }
}
