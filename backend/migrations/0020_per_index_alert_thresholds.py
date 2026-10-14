from django.db import migrations, models


def copy_existing_threshold(apps, schema_editor):
    # Keep each user's chosen BANKNIFTY threshold; SENSEX starts at its own smaller default.
    User = apps.get_model("backend", "User")
    for user in User.objects.all():
        user.banknifty_alert_lot_threshold = user.alert_lot_threshold or 400.0
        user.save(update_fields=["banknifty_alert_lot_threshold"])


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0019_user_market_columns"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="banknifty_alert_lot_threshold",
            field=models.FloatField(default=400.0),
        ),
        migrations.AddField(
            model_name="user",
            name="sensex_alert_lot_threshold",
            field=models.FloatField(default=40.0),
        ),
        migrations.RunPython(copy_existing_threshold, migrations.RunPython.noop),
    ]
