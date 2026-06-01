#include <string>
#include <iostream>

namespace Animals {

class Animal {
public:
  std::string name;
  Animal(std::string n) : name(n) {}
  virtual void speak() {}
};

class Dog : public Animal {
public:
  Dog(std::string n) : Animal(n) {}
  void speak() override {
    std::cout << "Woof!" << std::endl;
  }
};

} // namespace Animals

template<typename T>
T add(T a, T b) {
  return a + b;
}

int main() {
  Animals::Dog d("Rex");
  d.speak();
  return 0;
}
