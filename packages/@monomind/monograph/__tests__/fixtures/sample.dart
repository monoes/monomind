import 'package:flutter/material.dart';

abstract class Animal {
  String get name;
  String speak();
}

class Dog extends Animal {
  final String name;

  Dog(this.name);

  @override
  String speak() {
    return 'Woof!';
  }
}

class Cat extends Animal {
  final String name;

  Cat(this.name);

  @override
  String speak() {
    return 'Meow!';
  }
}

enum Direction { north, south, east, west }

String helperFn(String s) {
  return s.toUpperCase();
}
