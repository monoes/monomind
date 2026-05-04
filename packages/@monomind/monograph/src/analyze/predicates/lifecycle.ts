export const ANGULAR_LIFECYCLE_METHODS: Set<string> = new Set([
  "ngOnInit",
  "ngOnDestroy",
  "ngOnChanges",
  "ngDoCheck",
  "ngAfterContentInit",
  "ngAfterContentChecked",
  "ngAfterViewInit",
  "ngAfterViewChecked",
  "ngAcceptInputType",
  "canActivate",
  "canDeactivate",
  "canActivateChild",
  "canMatch",
  "resolve",
  "intercept",
  "transform",
  "validate",
  "registerOnChange",
  "registerOnTouched",
  "writeValue",
  "setDisabledState",
]);

export const REACT_LIFECYCLE_METHODS: Set<string> = new Set([
  "render",
  "componentDidMount",
  "componentDidUpdate",
  "componentWillUnmount",
  "shouldComponentUpdate",
  "getSnapshotBeforeUpdate",
  "getDerivedStateFromProps",
  "getDerivedStateFromError",
  "componentDidCatch",
  "componentWillMount",
  "componentWillReceiveProps",
  "componentWillUpdate",
  "UNSAFE_componentWillMount",
  "UNSAFE_componentWillReceiveProps",
  "UNSAFE_componentWillUpdate",
  "getChildContext",
  "contextType",
]);

export function isAngularLifecycleMethod(name: string): boolean {
  return ANGULAR_LIFECYCLE_METHODS.has(name);
}

export function isReactLifecycleMethod(name: string): boolean {
  return REACT_LIFECYCLE_METHODS.has(name);
}

export function isFrameworkLifecycleMethod(name: string): boolean {
  return isAngularLifecycleMethod(name) || isReactLifecycleMethod(name);
}
