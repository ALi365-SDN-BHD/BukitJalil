using Microsoft.Extensions.Logging;
using BukitJalil.Core;
using BukitJalil.Infrastructure;

namespace BukitJalil.App;

public static class MauiProgram
{
	public static MauiApp CreateMauiApp()
	{
		var builder = MauiApp.CreateBuilder();
		builder
			.UseMauiApp<App>()
			.ConfigureFonts(fonts =>
			{
				fonts.AddFont("OpenSans-Regular.ttf", "OpenSansRegular");
			});

		builder.Services.AddMauiBlazorWebView();
		builder.Services.AddBukitJalilCore();
		builder.Services.AddBukitJalilInfrastructure(options =>
		{
			options.AppDataDirectory = FileSystem.Current.AppDataDirectory;
		});

#if DEBUG
		builder.Services.AddBlazorWebViewDeveloperTools();
		builder.Logging.AddDebug();
#endif

		return builder.Build();
	}
}
