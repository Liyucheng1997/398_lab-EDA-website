`timescale 1ns / 1ps

// Basys 3 秒表 + 开关演示
//   · 16 个拨码开关直接驱动上方的 16 个 LED；
//   · 4 位数码管默认显示秒表「SS.cc」（00.00 ~ 99.99 秒）；
//   · BTNC 开始 / 暂停，BTNU 清零，BTND 计次（冻结显示，秒表在后台继续走，再按一次恢复）；
//   · BTNL 切到秒表显示，BTNR 切到「开关值十六进制」显示。
module basys3_stopwatch #(
  parameter CLK_HZ      = 100_000_000,  // 输入时钟频率（Hz）
  parameter SCAN_HZ     = 1_000,        // 数码管每一位的切换频率（Hz）
  parameter DEBOUNCE_MS = 10            // 按键消抖时间（ms）
) (
  input  logic        clk,              // 100 MHz
  input  logic [15:0] sw,
  input  logic [4:0]  btn,              // {BTND, BTNR, BTNL, BTNU, BTNC}，按下为 1
  output logic [15:0] led,
  output logic [7:0]  seg_n,            // {dp, g, f, e, d, c, b, a}，低电平点亮
  output logic [3:0]  an_n              // 低电平有效
);
  localparam TICK_DIV  = (CLK_HZ / 100 > 1) ? CLK_HZ / 100 : 1;             // 0.01 s
  localparam SCAN_DIV  = (CLK_HZ / SCAN_HZ > 1) ? CLK_HZ / SCAN_HZ : 1;
  localparam DB_CYCLES = (CLK_HZ * DEBOUNCE_MS / 1000 > 1) ? CLK_HZ * DEBOUNCE_MS / 1000 : 1;
  localparam TW        = $clog2(TICK_DIV + 1);

  localparam B_C = 0, B_U = 1, B_L = 2, B_R = 3, B_D = 4;

  // 开关 → LED
  assign led = sw;

  // 按键消抖
  logic [4:0] b_level, b_press;
  genvar gi;
  generate
    for (gi = 0; gi < 5; gi = gi + 1) begin : g_btn
      debounce #(.CYCLES(DB_CYCLES)) u_db (.clk(clk), .in(btn[gi]), .out(b_level[gi]), .rise(b_press[gi]));
    end
  endgenerate

  // 控制状态
  logic running  = 1'b0;
  logic lap      = 1'b0;
  logic hex_mode = 1'b0;

  always_ff @(posedge clk) begin
    if (b_press[B_C]) running  <= ~running;
    if (b_press[B_D]) lap      <= ~lap;
    if (b_press[B_L]) hex_mode <= 1'b0;
    if (b_press[B_R]) hex_mode <= 1'b1;
  end

  // 0.01 s 节拍
  logic [TW-1:0] tcnt = '0;
  logic          tick;
  assign tick = (tcnt >= TW'(TICK_DIV - 1));
  always_ff @(posedge clk) tcnt <= tick ? '0 : tcnt + 1'b1;

  // 4 位 BCD 计数：d3 d2 . d1 d0
  logic [3:0] d0 = '0, d1 = '0, d2 = '0, d3 = '0;
  always_ff @(posedge clk) begin
    if (b_press[B_U]) begin
      {d3, d2, d1, d0} <= 16'h0000;
    end else if (running && tick) begin
      if (d0 != 4'd9) d0 <= d0 + 4'd1;
      else begin
        d0 <= 4'd0;
        if (d1 != 4'd9) d1 <= d1 + 4'd1;
        else begin
          d1 <= 4'd0;
          if (d2 != 4'd9) d2 <= d2 + 4'd1;
          else begin
            d2 <= 4'd0;
            d3 <= (d3 != 4'd9) ? d3 + 4'd1 : 4'd0;   // 99.99 之后回到 00.00
          end
        end
      end
    end
  end

  // 计次：按下 BTND 时捕获当前值
  logic [15:0] lap_value = '0;
  always_ff @(posedge clk) if (b_press[B_D] && !lap) lap_value <= {d3, d2, d1, d0};

  logic [15:0] shown;
  assign shown = hex_mode ? sw : (lap ? lap_value : {d3, d2, d1, d0});

  seg7_scan #(.SCAN_DIV(SCAN_DIV)) u_scan (
    .clk(clk),
    .value(shown),
    .dp(hex_mode ? 4'b0000 : 4'b0100),   // 秒表模式在第 3 位（从右数）后显示小数点
    .blank(4'b0000),
    .seg_n(seg_n),
    .an_n(an_n)
  );
endmodule
