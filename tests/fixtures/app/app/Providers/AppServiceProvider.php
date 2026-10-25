<?php
namespace App\Providers;
use App\View\Components\Alert;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\ServiceProvider;
class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Blade::component('my-alert', Alert::class);
        Blade::componentNamespace('App\\View\\Components\\Nested', 'nested');
    }
}
