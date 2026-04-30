require 'json'
require 'net/http'

module Animals
  class Animal
    attr_reader :name

    def initialize(name)
      @name = name
    end

    def speak
      raise NotImplementedError, 'Subclass must implement speak'
    end
  end

  class Dog < Animal
    def speak
      "Woof!"
    end
  end
end

def helper_fn(x)
  x * 2
end
