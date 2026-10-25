// The oracle corpus: one entry per Blade feature. Each template is compiled by
// the real Laravel BladeCompiler (tests/oracle/compile.php) and by this
// package; the outputs must be byte-identical.
//
// `components: true` marks a template whose compilation needs the full app
// (ComponentTagCompiler resolves classes through the container).

export const CORPUS = [
  // ---- echos -------------------------------------------------------------
  { id: 'echo', src: '<h1>{{ $title }}</h1>' },
  { id: 'echo-newline', src: '{{ $x }}\n' },
  { id: 'echo-nested', src: '{{ $a["b"] }}' },
  { id: 'echo-call', src: '{{ route("home") }}' },
  { id: 'echo-trailing-semicolon', src: '{{ $x; }}' },
  { id: 'raw-echo', src: '{!! $html !!}' },
  { id: 'escaped-echo', src: '{{{ $x }}}' },
  { id: 'echo-escaped', src: '@{{ $x }}' },
  { id: 'echo-raw-escaped', src: '@{!! $x !!}' },
  { id: 'echo-multiline', src: '{{ $a\n  + $b }}' },
  { id: 'echo-in-string', src: '<?php $x = "{{ not an echo }}"; ?>' },

  // ---- comments ----------------------------------------------------------
  { id: 'comment', src: 'a{{-- hidden --}}b' },
  { id: 'comment-multiline', src: 'a{{--\nhidden\n--}}b' },
  { id: 'comment-with-directive', src: 'a{{-- @if(true) --}}b' },

  // ---- conditionals ------------------------------------------------------
  { id: 'if', src: '@if($a) yes @endif' },
  { id: 'if-else', src: '@if($a)\nyes\n@else\nno\n@endif' },
  { id: 'if-elseif', src: '@if($a)\na\n@elseif($b)\nb\n@endif' },
  { id: 'unless', src: '@unless($a)\nno\n@endunless' },
  { id: 'isset', src: '@isset($a)\nyes\n@endisset' },
  { id: 'auth', src: '@auth\nin\n@endauth' },
  { id: 'auth-guard', src: '@auth("admin")\nin\n@endauth' },
  { id: 'guest', src: '@guest\nout\n@endguest' },
  { id: 'elseauth', src: '@auth\na\n@elseauth\nb\n@endauth' },
  { id: 'env', src: '@env("local")\nl\n@endenv' },
  { id: 'production', src: '@production\np\n@endproduction' },
  { id: 'hassection', src: '@hasSection("x")\ny\n@endif' },
  { id: 'sectionmissing', src: '@sectionMissing("x")\nn\n@endif' },
  { id: 'hasstack', src: '@hasStack("s")\ny\n@endif' },
  { id: 'switch', src: '@switch($x)\n@case(1)\none\n@break\n@default\ndef\n@endswitch' },
  { id: 'switch-two-cases', src: '@switch($x)\n@case(1)\na\n@case(2)\nb\n@endswitch' },
  { id: 'once', src: '@once\nx\n@endonce' },
  { id: 'checked', src: '<input @checked($a)>' },
  { id: 'selected', src: '<option @selected($a)>' },
  { id: 'disabled', src: '<button @disabled($a)>' },
  { id: 'readonly', src: '<input @readonly($a)>' },
  { id: 'required', src: '<input @required($a)>' },
  { id: 'class', src: '<div @class(["a" => true])>' },
  { id: 'style', src: '<div @style(["color: red"])>' },
  { id: 'bool', src: '<div data-x="@bool($a)">' },
  { id: 'pushif', src: '@pushIf($a, "s")\nx\n@endPushIf' },

  // ---- loops -------------------------------------------------------------
  { id: 'foreach', src: '@foreach($items as $i)\n{{ $i }}\n@endforeach' },
  { id: 'foreach-key', src: '@foreach($items as $k => $v)\n{{ $k }}\n@endforeach' },
  { id: 'forelse', src: '@forelse($items as $i)\n{{ $i }}\n@empty\nnone\n@endforelse' },
  { id: 'for', src: '@for($i = 0; $i < 3; $i++)\n{{ $i }}\n@endfor' },
  { id: 'while', src: '@while($a)\nx\n@endwhile' },
  { id: 'break', src: '@foreach($a as $b)\n@break\n@endforeach' },
  { id: 'continue', src: '@foreach($a as $b)\n@continue\n@endforeach' },
  { id: 'break-2', src: '@foreach($a as $b)\n@break(2)\n@endforeach' },

  // ---- layouts -----------------------------------------------------------
  { id: 'extends', src: '@extends("layouts.app")\nx' },
  { id: 'extends-first', src: '@extendsFirst(["a", "b"])\nx' },
  { id: 'section', src: '@section("content")\nx\n@endsection' },
  { id: 'section-inline', src: '@section("title", "Hi")' },
  { id: 'yield', src: '@yield("content")' },
  { id: 'yield-default', src: '@yield("content", "fallback")' },
  { id: 'parent', src: '@section("c")\n@parent\n@endsection' },
  { id: 'show', src: '@section("c")\nx\n@show' },
  { id: 'append', src: '@section("c")\nx\n@append' },
  { id: 'overwrite', src: '@section("c")\nx\n@overwrite' },
  { id: 'stop', src: '@section("c")\nx\n@stop' },

  // ---- stacks ------------------------------------------------------------
  { id: 'push', src: '@push("scripts")\n<script></script>\n@endpush' },
  { id: 'stack', src: '@stack("scripts")' },
  { id: 'prepend', src: '@prepend("scripts")\nx\n@endprepend' },
  { id: 'pushonce', src: '@pushOnce("scripts", "id")\nx\n@endPushOnce' },

  // ---- includes ----------------------------------------------------------
  { id: 'include', src: '@include("partials.x")' },
  { id: 'include-data', src: '@include("partials.x", ["a" => 1])' },
  { id: 'includeif', src: '@includeIf("partials.x")' },
  { id: 'includewhen', src: '@includeWhen($a, "partials.x")' },
  { id: 'includeunless', src: '@includeUnless($a, "partials.x")' },
  { id: 'includefirst', src: '@includeFirst(["a", "b"])' },
  { id: 'each', src: '@each("partials.x", $items, "item")' },

  // ---- errors / sessions / translations ----------------------------------
  { id: 'error', src: '@error("email")\n{{ $message }}\n@enderror' },
  { id: 'error-bag', src: '@error("email", "login")\n{{ $message }}\n@enderror' },
  { id: 'session', src: '@session("status")\n{{ $value }}\n@endsession' },
  { id: 'lang', src: '@lang("messages.welcome")' },
  { id: 'lang-block', src: '@lang("messages.welcome")\nHello\n@endlang' },
  { id: 'choice', src: '@choice("messages.apples", 3)' },
  { id: 'inject', src: '@inject("metrics", "App\\Services\\Metrics")' },
  { id: 'use', src: '@use("App\\Models\\Post")' },

  // ---- helpers -----------------------------------------------------------
  { id: 'csrf', src: '@csrf' },
  { id: 'method', src: '@method("PUT")' },
  { id: 'vite', src: "@vite(['resources/css/app.css'])" },
  { id: 'vite-react', src: '@viteReactRefresh' },
  { id: 'json', src: '@json($data)' },
  { id: 'json-options', src: '@json($data, 15, 512)' },
  { id: 'js', src: '@js($data)' },
  { id: 'dump', src: '@dump($x)' },
  { id: 'dd', src: '@dd($x)' },
  { id: 'php-inline', src: '@php($x = 1)' },
  { id: 'php-block', src: '@php\n$x = 1;\n@endphp' },
  { id: 'unset', src: '@unset($x)' },
  { id: 'verbatim', src: '@verbatim\n{{ not compiled }}\n@endverbatim' },

  // ---- components (need the app) ----------------------------------------
  { id: 'component-selfclosing', src: '<x-alert type="danger" />', components: true },
  { id: 'component-open-close', src: '<x-alert>hi</x-alert>', components: true },
  { id: 'component-bound', src: '<x-alert :count="$n" />', components: true },
  { id: 'component-attr-novalue', src: '<x-alert disabled />', components: true },
  { id: 'component-class-directive', src: '<x-alert @class(["a" => true]) />', components: true },
  { id: 'component-slot', src: '<x-alert><x-slot:title>T</x-slot:title>hi</x-alert>', components: true },
  { id: 'component-anonymous', src: '<x-forms.input name="email" />', components: true },

  // ---- escapes / edge cases ---------------------------------------------
  { id: 'escaped-directive', src: '@@if and text' },
  { id: 'unknown-directive-passthrough', src: '@notADirective' },
  { id: 'directive-in-php', src: '<?php // @if($a) ?>' },
  { id: 'crlf', src: '@if($a)\r\nx\r\n@endif' },
];
