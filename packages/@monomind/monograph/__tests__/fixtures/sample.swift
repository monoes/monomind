import Foundation

protocol Greetable {
  func greet() -> String
}

struct Person: Greetable {
  var name: String

  func greet() -> String {
    return "Hello, \(name)"
  }
}

class Animal {
  var name: String

  init(name: String) {
    self.name = name
  }

  func speak() {
    print("\(name) speaks")
  }
}

class Dog: Animal {
  override func speak() {
    print("Woof!")
  }
}

enum Direction {
  case north
  case south
  case east
  case west
}

func helperFn() -> Int {
  return 42
}
