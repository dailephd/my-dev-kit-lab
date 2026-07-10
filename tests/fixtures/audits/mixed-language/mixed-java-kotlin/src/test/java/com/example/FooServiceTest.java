package com.example;

public class FooServiceTest {
    public void testGreet() {
        FooService service = new FooService();
        assert service.greet("world").equals("Hello, world");
    }
}
