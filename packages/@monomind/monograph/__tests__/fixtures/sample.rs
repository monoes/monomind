use std::collections::HashMap;

pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

fn internal_helper(x: i32) -> i32 {
    x * 2
}

pub struct Config {
    pub name: String,
}

pub trait Service {
    fn run(&self);
}
