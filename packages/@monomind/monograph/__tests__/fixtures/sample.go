package sample

import "fmt"

type MyInt int

type Greeter interface {
	Greet() string
}

type Person struct {
	Name string
	Age  int
}

func (p Person) Greet() string {
	return fmt.Sprintf("Hello, %s", p.Name)
}

func Add(a, b int) int {
	return a + b
}

func helperFn() int {
	return 42
}
