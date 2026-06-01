#include <stdio.h>
#include <stdlib.h>

typedef struct {
  int x;
  int y;
} Point;

enum Color { RED, GREEN, BLUE };

int add(int a, int b) {
  return a + b;
}

int multiply(int a, int b) {
  return a * b;
}

int main(void) {
  Point p;
  p.x = add(1, 2);
  p.y = multiply(3, 4);
  printf("x=%d y=%d\n", p.x, p.y);
  return 0;
}
